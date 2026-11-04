import { END_REASON_VI, Game, START_FEN, makeMove, type EndReason, type GameResult, type Side } from '@xq/engine';
import { AI_LEVELS, AI_PROFILES, type AiLevel } from '@xq/engine/ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiClient } from '../ai/client';
import { Board } from '../components/Board';
import { SoundControl } from '../components/common';
import { MoveList, PlayerBar, ResultBanner } from '../components/GamePanels';
import { playSound } from '../lib/sound';

const SAVE_KEY = 'xq.ai.v1';
/** Thời gian tối thiểu trước khi hiển thị nước của máy – chỉ để người chơi kịp thấy animation, áp dụng như nhau cho mọi mức. */
const MIN_DISPLAY_MS = 350;

interface Saved {
  level: AiLevel;
  human: Side;
  startFen: string;
  moves: string[];
  flipped: boolean;
}

function loadSaved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Saved | null;
    if (v && AI_LEVELS.includes(v.level) && Array.isArray(v.moves)) return v;
  } catch {
    /* bỏ qua */
  }
  return null;
}

type ColorChoice = Side | 'random';

export function AiPage() {
  const saved = useMemo(loadSaved, []);
  const [phase, setPhase] = useState<'setup' | 'playing'>('setup');
  const [level, setLevel] = useState<AiLevel>(saved?.level ?? 'medium');
  const [color, setColor] = useState<ColorChoice>('red');
  const [human, setHuman] = useState<Side>('red');
  const [flipped, setFlipped] = useState(false);
  const [ver, setVer] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [aiInfo, setAiInfo] = useState<string>('');
  const [resigned, setResigned] = useState<{ result: GameResult; reason: EndReason } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gameRef = useRef<Game>(new Game());
  const verRef = useRef(0);
  const aiRef = useRef<AiClient | null>(null);

  useEffect(() => {
    aiRef.current = new AiClient();
    return () => aiRef.current?.dispose();
  }, []);

  const bump = useCallback(() => {
    verRef.current += 1;
    setVer(verRef.current);
  }, []);

  const game = gameRef.current;
  const status = game.status;
  const over = status.over || !!resigned;
  const result = resigned ?? (status.over ? { result: status.result!, reason: status.reason! } : null);
  const aiSide: Side = human === 'red' ? 'black' : 'red';

  const save = useCallback(() => {
    const g = gameRef.current;
    try {
      if (g.status.over) localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY, JSON.stringify({ level, human, startFen: g.startFen, moves: g.movesIccs(), flipped } satisfies Saved));
    } catch {
      /* bỏ qua */
    }
  }, [level, human, flipped]);

  const soundFor = (g: Game) => {
    const last = g.history[g.history.length - 1];
    if (g.status.over) playSound('end');
    else if (last?.givesCheck) playSound('check');
    else if (last?.captured) playSound('capture');
    else playSound('move');
  };

  const start = (lv: AiLevel, choice: ColorChoice) => {
    aiRef.current?.cancel();
    const side: Side = choice === 'random' ? (Math.random() < 0.5 ? 'red' : 'black') : choice;
    gameRef.current = new Game(START_FEN);
    setLevel(lv);
    setHuman(side);
    setFlipped(side === 'black');
    setResigned(null);
    setAiInfo('');
    setError(null);
    setThinking(false);
    setPhase('playing');
    bump();
    window.scrollTo({ top: 0 });
  };

  const resume = (s: Saved) => {
    try {
      const g = new Game(s.startFen);
      for (const m of s.moves) g.play(m);
      gameRef.current = g;
      setLevel(s.level);
      setHuman(s.human);
      setFlipped(s.flipped);
      setResigned(null);
      setPhase('playing');
      bump();
    } catch {
      localStorage.removeItem(SAVE_KEY);
      setError('Không khôi phục được ván đã lưu');
    }
  };

  // Lượt của máy
  useEffect(() => {
    if (phase !== 'playing' || over) return;
    const g = gameRef.current;
    if (g.sideToMove !== aiSide) return;
    const ai = aiRef.current;
    if (!ai) return;
    const myVersion = verRef.current;
    const started = performance.now();
    setThinking(true);
    let alive = true;
    ai.request({ startFen: g.startFen, moves: g.movesIccs(), level, positionVersion: myVersion })
      .then(async (r) => {
        if (!r || !alive || r.positionVersion !== verRef.current || !r.move) return;
        const wait = MIN_DISPLAY_MS - (performance.now() - started);
        if (wait > 0) await new Promise((res) => setTimeout(res, wait));
        if (!alive || r.positionVersion !== verRef.current) return; // vị trí đã đổi (undo/restart/đổi level)
        const cur = gameRef.current;
        if (cur.status.over || cur.sideToMove !== aiSide) return;
        try {
          cur.play(r.move);
        } catch {
          setError('Máy trả về nước không hợp lệ – đã bỏ qua');
          return;
        }
        setAiInfo(`Độ sâu ${r.depth} · ${r.nodes.toLocaleString('vi-VN')} nút · ${r.timeMs} ms`);
        soundFor(cur);
        bump();
      })
      .catch((e) => setError(`AI lỗi: ${String((e as Error).message)}`))
      .finally(() => {
        if (alive) setThinking(false);
      });
    return () => {
      alive = false;
      ai.cancel();
      setThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, phase, over, aiSide, level]);

  useEffect(() => {
    if (phase === 'playing') save();
  }, [ver, phase, save]);

  const humanTurn = phase === 'playing' && !over && game.sideToMove === human;

  const canSelect = useCallback(
    (sq: number) => {
      const p = gameRef.current.position.board[sq];
      return humanTurn && p !== 0 && (p > 0 ? 'red' : 'black') === human;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [humanTurn, human, ver],
  );
  const targetsOf = useCallback((sq: number) => gameRef.current.legalTargets(sq), []);
  const onMove = (from: number, to: number) => {
    const g = gameRef.current;
    if (!humanTurn) return;
    try {
      g.play(makeMove(from, to));
    } catch {
      return;
    }
    soundFor(g);
    bump();
  };

  const undo = () => {
    aiRef.current?.cancel();
    const g = gameRef.current;
    if (resigned) setResigned(null);
    // Lùi về lượt của người chơi, bỏ ít nhất một nước của người chơi.
    let n = g.sideToMove === human ? 2 : 1;
    while (n-- > 0 && g.history.length > 0) g.undo();
    while (g.history.length > 0 && g.sideToMove !== human) g.undo();
    bump();
  };

  const board = game.position.board;
  const lastRec = game.history[game.history.length - 1];
  const lastMove = lastRec ? { from: lastRec.move & 127, to: lastRec.move >> 7 } : null;
  const checkSq = status.inCheck && !over ? game.position.kings[game.sideToMove === 'red' ? 0 : 1] : null;

  if (phase === 'setup') {
    return (
      <div className="page narrow">
        <h1>Chơi với máy</h1>
        {saved && saved.moves.length > 0 && (
          <div className="card highlight">
            <p>
              Bạn có ván đang dở với mức <strong>{AI_PROFILES[saved.level].label}</strong> ({saved.moves.length} nửa nước).
            </p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => resume(saved)}>
                Tiếp tục ván
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  localStorage.removeItem(SAVE_KEY);
                  window.location.reload();
                }}
              >
                Bỏ ván
              </button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <fieldset className="card">
          <legend>Mức độ</legend>
          <div className="level-grid" role="radiogroup" aria-label="Mức độ">
            {AI_LEVELS.map((lv) => (
              <label key={lv} className={`level-option${level === lv ? ' checked' : ''}`}>
                <input type="radio" name="level" value={lv} checked={level === lv} onChange={() => setLevel(lv)} />
                <strong>{AI_PROFILES[lv].label}</strong>
                <small>{AI_PROFILES[lv].description}</small>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="card">
          <legend>Bạn cầm quân</legend>
          <div className="row" role="radiogroup" aria-label="Màu quân">
            {(
              [
                ['red', 'Đỏ (đi trước)'],
                ['black', 'Đen'],
                ['random', 'Ngẫu nhiên'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className={`chip${color === v ? ' checked' : ''}`}>
                <input type="radio" name="color" value={v} checked={color === v} onChange={() => setColor(v)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="button" className="btn primary big" onClick={() => start(level, color)} data-testid="ai-start">
          Bắt đầu
        </button>
      </div>
    );
  }

  const top: Side = flipped ? 'red' : 'black';
  const bottom: Side = flipped ? 'black' : 'red';
  const nameOf = (s: Side) => (s === human ? 'Bạn' : `Máy · ${AI_PROFILES[level].label}`);
  let resultText = '';
  if (result) {
    resultText = result.result === 'draw' ? 'Hòa' : result.result === human ? 'Bạn thắng!' : 'Bạn thua';
  }

  return (
    <div className="game-layout">
      <section className="board-col">
        <PlayerBar name={nameOf(top)} side={top} active={!over && game.sideToMove === top} note={top === aiSide && thinking ? 'đang nghĩ…' : undefined} />
        <Board
          board={board}
          flipped={flipped}
          canSelect={canSelect}
          targetsOf={targetsOf}
          onMove={onMove}
          lastMove={lastMove}
          checkSq={checkSq}
          disabled={!humanTurn}
          ariaLabel="Bàn cờ – chơi với máy"
        />
        <PlayerBar name={nameOf(bottom)} side={bottom} active={!over && game.sideToMove === bottom} note={bottom === aiSide && thinking ? 'đang nghĩ…' : undefined} />
      </section>
      <aside className="side-col">
        <div className="card">
          <div className="row between">
            <strong>{AI_PROFILES[level].label}</strong>
            <span className="muted small" aria-live="polite">
              {over ? 'Ván đã kết thúc' : thinking ? 'Máy đang nghĩ…' : humanTurn ? 'Đến lượt bạn' : ''}
            </span>
          </div>
          {status.inCheck && !over && <p className="check-alert">Chiếu tướng!</p>}
          {aiInfo && <p className="muted small">{aiInfo}</p>}
          {error && <p className="error">{error}</p>}
          {result && (
            <ResultBanner text={resultText} sub={END_REASON_VI[result.reason]}>
              <button type="button" className="btn primary" onClick={() => start(level, color)}>
                Ván mới
              </button>
            </ResultBanner>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={() => start(level, color)}>
              Ván mới
            </button>
            <button type="button" className="btn" onClick={undo} disabled={game.history.length === 0}>
              Đi lại
            </button>
            <button type="button" className="btn" onClick={() => setFlipped((f) => !f)}>
              Lật bàn
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={over}
              onClick={() => {
                aiRef.current?.cancel();
                setResigned({ result: aiSide, reason: 'resign' });
                playSound('end');
                localStorage.removeItem(SAVE_KEY);
              }}
            >
              Đầu hàng
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                aiRef.current?.cancel();
                setPhase('setup');
              }}
            >
              Đổi mức / màu
            </button>
          </div>
          <SoundControl />
        </div>
        <div className="card grow">
          <h2 className="h3">Nước đi</h2>
          <MoveList moves={game.history.map((h) => h.vn)} />
        </div>
      </aside>
    </div>
  );
}

