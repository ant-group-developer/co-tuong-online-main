import { Game, START_FEN, makeMove, type EndReason, type GameResult, type Side } from '@xq/engine';
import type { AiLevel } from '@xq/engine/ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { AiClient } from '../ai/client';
import { infoOf, isAiLevel, levelName, loadRecords, newGameId, nextLevel, recordResult, thinkText, type Records } from '../ai/levels';
import { AiLevelPicker, ColorPicker, Stars, useRecordText, type ColorChoice } from '../components/AiLevelPicker';
import { Board } from '../components/Board';
import { Modal, SoundControl } from '../components/common';
import { MoveList, PlayerBar, ResultBanner } from '../components/GamePanels';
import { fmtNumber, moveText } from '../i18n';
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
  gameId?: string;
  /** Đã đổi máy giữa ván: kết quả không tính vào thành tích. */
  switched?: boolean;
}

function loadSaved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Saved | null;
    if (v && isAiLevel(v.level) && Array.isArray(v.moves)) return v;
  } catch {
    /* bỏ qua */
  }
  return null;
}

export function AiPage() {
  const { t } = useTranslation();
  const recordText = useRecordText();
  const saved = useMemo(loadSaved, []);
  const [params] = useSearchParams();
  const qLevel = params.get('level');
  const [phase, setPhase] = useState<'setup' | 'playing'>('setup');
  const [level, setLevel] = useState<AiLevel>(isAiLevel(qLevel) ? qLevel : (saved?.level ?? 'medium'));
  const [color, setColor] = useState<ColorChoice>('red');
  const [human, setHuman] = useState<Side>('red');
  const [flipped, setFlipped] = useState(false);
  const [ver, setVer] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [aiInfo, setAiInfo] = useState<string>('');
  const [resigned, setResigned] = useState<{ result: GameResult; reason: EndReason } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gameId, setGameId] = useState(newGameId);
  const [switched, setSwitched] = useState(false);
  const [records, setRecords] = useState<Records>(loadRecords);
  const [picker, setPicker] = useState(false);
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
      else
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({ level, human, startFen: g.startFen, moves: g.movesIccs(), flipped, gameId, switched } satisfies Saved),
        );
    } catch {
      /* bỏ qua */
    }
  }, [level, human, flipped, gameId, switched]);

  const soundFor = (g: Game) => {
    const last = g.history[g.history.length - 1];
    if (g.status.over) playSound('end');
    else if (last?.givesCheck) playSound('check');
    else if (last?.captured) playSound('capture');
    else playSound('move');
  };

  /** Bắt đầu ván mới với máy `lv`. */
  const start = (lv: AiLevel, choice: ColorChoice) => {
    aiRef.current?.cancel();
    const side: Side = choice === 'random' ? (Math.random() < 0.5 ? 'red' : 'black') : choice;
    gameRef.current = new Game(START_FEN);
    setLevel(lv);
    setColor(choice);
    setHuman(side);
    setFlipped(side === 'black');
    setResigned(null);
    setAiInfo('');
    setError(null);
    setThinking(false);
    setGameId(newGameId());
    setSwitched(false);
    setPicker(false);
    setPhase('playing');
    bump();
    window.scrollTo({ top: 0 });
  };

  /** Đổi máy giữa ván, giữ nguyên thế cờ. Ván này không tính vào thành tích. */
  const switchLevelKeep = (lv: AiLevel) => {
    setPicker(false);
    if (lv === level) return;
    aiRef.current?.cancel();
    setThinking(false);
    setLevel(lv);
    setSwitched(true);
    setAiInfo('');
    bump(); // đổi positionVersion: kết quả tìm kiếm của máy cũ (nếu còn) bị bỏ
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
      setGameId(s.gameId ?? newGameId());
      setSwitched(!!s.switched);
      setPhase('playing');
      bump();
    } catch {
      localStorage.removeItem(SAVE_KEY);
      setError(t('ai.restoreFailed'));
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
        if (!alive || r.positionVersion !== verRef.current) return; // vị trí đã đổi (undo/restart/đổi máy)
        const cur = gameRef.current;
        if (cur.status.over || cur.sideToMove !== aiSide) return;
        try {
          cur.play(r.move);
        } catch {
          setError(t('ai.badAiMove'));
          return;
        }
        setAiInfo(t('ai.searchInfo', { depth: r.depth, nodes: fmtNumber(r.nodes), ms: r.timeMs }));
        soundFor(cur);
        bump();
      })
      .catch((e) => setError(t('ai.aiError', { message: String((e as Error).message) })))
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

  // Ghi thành tích khi ván kết thúc (một lần cho mỗi ván, bỏ qua ván đã đổi máy giữa chừng hoặc chưa đi nước nào)
  useEffect(() => {
    if (phase !== 'playing' || !result || switched || game.history.length < 2) return;
    const outcome = result.result === 'draw' ? 'd' : result.result === human ? 'w' : 'l';
    setRecords(recordResult(gameId, level, outcome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result?.result, result?.reason, gameId]);

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
      <div className="page narrow-wide stack">
        <h1>{t('ai.title')}</h1>
        {saved && saved.moves.length > 0 && (
          <div className="card highlight stack">
            <p>
              <Trans i18nKey="ai.unfinished" values={{ level: levelName(saved.level), count: saved.moves.length }} components={{ b: <strong /> }} />
            </p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => resume(saved)}>
                {t('ai.resume')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  localStorage.removeItem(SAVE_KEY);
                  window.location.reload();
                }}
              >
                {t('ai.discard')}
              </button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <section className="stack">
          <h2 className="h3">{t('ai.step1')}</h2>
          <AiLevelPicker value={level} onChange={setLevel} records={records} />
        </section>
        <section className="card stack">
          <h2 className="h3">{t('ai.step2')}</h2>
          <ColorPicker value={color} onChange={setColor} />
        </section>
        <div className="row">
          <button type="button" className="btn primary big" onClick={() => start(level, color)} data-testid="ai-start">
            {t('ai.startWith', { level: levelName(level) })}
          </button>
        </div>
      </div>
    );
  }

  const top: Side = flipped ? 'red' : 'black';
  const bottom: Side = flipped ? 'black' : 'red';
  const info = infoOf(level);
  const nameOf = (s: Side) => (s === human ? t('ai.you') : t('ai.machine', { level: levelName(level) }));
  let resultText = '';
  if (result) {
    resultText = result.result === 'draw' ? t('ai.draw') : result.result === human ? t('ai.win') : t('ai.loss');
  }
  const won = !!result && result.result === human;
  const lost = !!result && result.result !== 'draw' && result.result !== human;
  const harder = nextLevel(level, 1);
  const easier = nextLevel(level, -1);
  const inProgress = !over && game.history.length > 0;

  return (
    <div className="game-layout">
      {picker && (
        <ChangeAiModal
          current={level}
          color={color}
          records={records}
          inProgress={inProgress}
          onClose={() => setPicker(false)}
          onKeep={switchLevelKeep}
          onNew={start}
        />
      )}
      <section className="board-col">
        <PlayerBar name={nameOf(top)} side={top} active={!over && game.sideToMove === top} note={top === aiSide && thinking ? t('panel.thinking') : undefined} />
        <Board
          board={board}
          flipped={flipped}
          canSelect={canSelect}
          targetsOf={targetsOf}
          onMove={onMove}
          lastMove={lastMove}
          checkSq={checkSq}
          disabled={!humanTurn}
          ariaLabel={t('board.vsAi')}
        />
        <PlayerBar name={nameOf(bottom)} side={bottom} active={!over && game.sideToMove === bottom} note={bottom === aiSide && thinking ? t('panel.thinking') : undefined} />
      </section>
      <aside className="side-col">
        <div className="card opponent-card" data-testid="opponent-card">
          <div className="opponent-main">
            <span className="opponent-avatar" aria-hidden="true">
              {info.stars}
            </span>
            <div className="stack-tight">
              <span className="muted small">{t('ai.opponent')}</span>
              <strong data-testid="opponent-name">{t('ai.machine', { level: levelName(level) })}</strong>
              <Stars n={info.stars} />
            </div>
          </div>
          <p className="muted small">{t(`levels.${level}.play`)}</p>
          <p className="muted small">
            {thinkText(level)} · {recordText(records[level])}
          </p>
          {switched && <p className="muted small">{t('ai.switchedNote')}</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setPicker(true)} data-testid="change-ai">
              {t('ai.changeAi')}
            </button>
          </div>
        </div>
        <div className="card">
          <div className="row between">
            <strong>{t('ai.yourGame')}</strong>
            <span className="muted small" aria-live="polite">
              {over ? t('ai.over') : thinking ? t('ai.thinking') : humanTurn ? t('ai.yourTurn') : ''}
            </span>
          </div>
          {status.inCheck && !over && <p className="check-alert">{t('ai.check')}</p>}
          {aiInfo && <p className="muted small">{aiInfo}</p>}
          {error && <p className="error">{error}</p>}
          {result && (
            <ResultBanner text={resultText} sub={t(`endReason.${result.reason}`)}>
              {won && harder && (
                <button type="button" className="btn primary" onClick={() => start(harder, color)} data-testid="try-harder">
                  {t('ai.tryHarder', { level: levelName(harder) })}
                </button>
              )}
              {lost && easier && (
                <button type="button" className="btn primary" onClick={() => start(easier, color)} data-testid="try-easier">
                  {t('ai.tryEasier', { level: levelName(easier) })}
                </button>
              )}
              <button type="button" className={`btn${(won && harder) || (lost && easier) ? '' : ' primary'}`} onClick={() => start(level, color)}>
                {t('ai.sameAgain')}
              </button>
              <button type="button" className="btn" onClick={() => setPicker(true)} data-testid="result-change-ai">
                {t('ai.pickOther')}
              </button>
            </ResultBanner>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={() => start(level, color)}>
              {t('common.newGame')}
            </button>
            <button type="button" className="btn" onClick={undo} disabled={game.history.length === 0}>
              {t('common.undo')}
            </button>
            <button type="button" className="btn" onClick={() => setFlipped((f) => !f)}>
              {t('common.flipBoard')}
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={over}
              data-testid="ai-resign"
              onClick={() => {
                aiRef.current?.cancel();
                setResigned({ result: aiSide, reason: 'resign' });
                playSound('end');
                localStorage.removeItem(SAVE_KEY);
              }}
            >
              {t('common.resign')}
            </button>
          </div>
          <SoundControl />
        </div>
        <div className="card grow">
          <h2 className="h3">{t('panel.moves')}</h2>
          <MoveList moves={game.history.map(moveText)} />
        </div>
      </aside>
    </div>
  );
}

/** Hộp chọn máy khác: đổi ngay (giữ thế cờ) hoặc bắt đầu ván mới. */
function ChangeAiModal({
  current,
  color,
  records,
  inProgress,
  onClose,
  onKeep,
  onNew,
}: {
  current: AiLevel;
  color: ColorChoice;
  records: Records;
  inProgress: boolean;
  onClose: () => void;
  onKeep: (lv: AiLevel) => void;
  onNew: (lv: AiLevel, c: ColorChoice) => void;
}) {
  const [lv, setLv] = useState<AiLevel>(current);
  const { t } = useTranslation();
  const [c, setC] = useState<ColorChoice>(color);
  const name = levelName(lv);
  return (
    <Modal title={t('ai.modalTitle')} onClose={onClose} wide>
      <AiLevelPicker value={lv} onChange={setLv} records={records} current={current} name="change-level" />
      {inProgress && (
        <div className="choice-box stack-tight">
          <strong>{t('ai.keepTitle')}</strong>
          <span className="muted small">{t('ai.keepNote', { level: name })}</span>
          <div className="row">
            <button type="button" className="btn primary" disabled={lv === current} onClick={() => onKeep(lv)} data-testid="switch-keep">
              {t('ai.keepBtn', { level: name })}
            </button>
          </div>
        </div>
      )}
      <div className="choice-box stack-tight">
        <strong>{t('ai.newTitle')}</strong>
        <ColorPicker value={c} onChange={setC} name="change-color" />
        <div className="row">
          <button type="button" className={`btn${inProgress ? '' : ' primary'}`} onClick={() => onNew(lv, c)} data-testid="switch-new">
            {t('ai.newBtn', { level: name })}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
