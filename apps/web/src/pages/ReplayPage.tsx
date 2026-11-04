import { END_REASON_VI, Game, type EndReason } from '@xq/engine';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Board } from '../components/Board';
import { ErrorState, NotConfigured, Spinner } from '../components/common';
import { MoveList, PlayerBar } from '../components/GamePanels';
import { errorVi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fb } from '../lib/firebase';

interface MatchArchive {
  matchId: string;
  mode: string;
  rated: boolean;
  red: { uid: string; name: string; ratingBefore: number | null; ratingAfter: number | null };
  black: { uid: string; name: string; ratingBefore: number | null; ratingAfter: number | null };
  winner: 'red' | 'black' | 'draw';
  reason: EndReason;
  startFen: string;
  moves: string[];
  endedAt: number;
  finalHash: string;
}

export function ReplayPage() {
  const { matchId = '' } = useParams();
  const auth = useAuth();
  const [data, setData] = useState<MatchArchive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!auth.configured || !auth.ready) return;
    (async () => {
      try {
        await auth.ensureSignedIn();
        const snap = await getDoc(doc(fb().fs, 'matches', matchId));
        if (!snap.exists()) {
          setError('Chưa có bản lưu của trận này (kết quả có thể đang được xử lý, hãy thử lại sau ít giây).');
          return;
        }
        const d = snap.data() as MatchArchive;
        setData(d);
        setPly(d.moves.length);
        setFlipped(auth.user?.uid === d.black.uid);
      } catch (e) {
        setError(errorVi(e));
      }
    })();
  }, [auth.configured, auth.ready, matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dựng toàn bộ ván một lần; kiểm tra tính toàn vẹn (hash cuối) khi replay.
  const full = useMemo(() => {
    if (!data) return null;
    try {
      const g = new Game(data.startFen);
      for (const m of data.moves) g.play(m);
      return { game: g, verified: g.stateHash() === data.finalHash };
    } catch {
      return null;
    }
  }, [data]);

  const view = useMemo(() => {
    if (!data) return null;
    const g = new Game(data.startFen);
    for (let i = 0; i < ply; i++) g.play(data.moves[i]);
    return g;
  }, [data, ply]);

  useEffect(() => {
    if (!playing || !data) return;
    if (ply >= data.moves.length) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setPly((p) => p + 1), 900);
    return () => window.clearTimeout(id);
  }, [playing, ply, data]);

  if (!auth.configured) return <NotConfigured />;
  if (error) return <ErrorState message={error} action={<Link className="btn" to="/profile">Về hồ sơ</Link>} />;
  if (!data || !view) return <Spinner label="Đang tải bản ghi…" />;

  const last = view.history[view.history.length - 1];
  const top = flipped ? 'red' : 'black';
  const bottom = flipped ? 'black' : 'red';
  const resultText = data.winner === 'draw' ? 'Hòa' : `${data[data.winner].name} (${data.winner === 'red' ? 'Đỏ' : 'Đen'}) thắng`;
  return (
    <div className="game-layout">
      <section className="board-col">
        <PlayerBar name={data[top].name} side={top} rating={data[top].ratingBefore} />
        <Board
          board={view.position.board}
          flipped={flipped}
          lastMove={last ? { from: last.move & 127, to: last.move >> 7 } : null}
          checkSq={view.status.inCheck ? view.position.kings[view.sideToMove === 'red' ? 0 : 1] : null}
          disabled
          ariaLabel="Bàn cờ – xem lại"
        />
        <PlayerBar name={data[bottom].name} side={bottom} rating={data[bottom].ratingBefore} />
      </section>
      <aside className="side-col">
        <div className="card">
          <strong>{resultText}</strong>
          <p className="muted small">
            {END_REASON_VI[data.reason]} · {data.rated ? 'Xếp hạng' : 'Giao hữu'} · {new Date(data.endedAt).toLocaleString('vi-VN')}
          </p>
          {full && !full.verified && <p className="error">Cảnh báo: bản ghi không khớp hash cuối.</p>}
          <div className="actions">
            <button type="button" className="btn" onClick={() => setPly(0)} aria-label="Về đầu">
              ⏮
            </button>
            <button type="button" className="btn" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Lùi">
              ◀
            </button>
            <button type="button" className="btn" onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Dừng' : 'Tự chạy'}>
              {playing ? '⏸' : '▶︎'}
            </button>
            <button type="button" className="btn" onClick={() => setPly((p) => Math.min(data.moves.length, p + 1))} aria-label="Tiến">
              ▶
            </button>
            <button type="button" className="btn" onClick={() => setPly(data.moves.length)} aria-label="Về cuối">
              ⏭
            </button>
            <button type="button" className="btn" onClick={() => setFlipped((f) => !f)}>
              Lật bàn
            </button>
          </div>
          <p className="muted small">
            Nước {ply}/{data.moves.length}
          </p>
        </div>
        <div className="card grow">
          <MoveList moves={full?.game.history.map((h) => h.vn) ?? []} current={ply} onSelect={setPly} />
        </div>
      </aside>
    </div>
  );
}
