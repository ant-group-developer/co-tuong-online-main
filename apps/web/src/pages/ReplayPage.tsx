import { Game, type EndReason } from '@xq/engine';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Board } from '../components/Board';
import { ErrorState, NotConfigured, Spinner } from '../components/common';
import { MoveList, PlayerBar } from '../components/GamePanels';
import { fmtDateTime, moveText } from '../i18n';
import { errorText } from '../lib/api';
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
  const { t } = useTranslation();
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
          setError(t('replay.noArchive'));
          return;
        }
        const d = snap.data() as MatchArchive;
        setData(d);
        setPly(d.moves.length);
        setFlipped(auth.user?.uid === d.black.uid);
      } catch (e) {
        setError(errorText(e));
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
  if (error) return <ErrorState message={error} action={<Link className="btn" to="/profile">{t('replay.backToProfile')}</Link>} />;
  if (!data || !view) return <Spinner label={t('replay.loading')} />;

  const last = view.history[view.history.length - 1];
  const top = flipped ? 'red' : 'black';
  const bottom = flipped ? 'black' : 'red';
  const resultText = data.winner === 'draw' ? t('replay.draw') : t('replay.winner', { name: data[data.winner].name, side: t(`side.${data.winner}`) });
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
          ariaLabel={t('board.replay')}
        />
        <PlayerBar name={data[bottom].name} side={bottom} rating={data[bottom].ratingBefore} />
      </section>
      <aside className="side-col">
        <div className="card">
          <strong>{resultText}</strong>
          <p className="muted small">
            {t(`endReason.${data.reason}`)} · {data.rated ? t('replay.ranked') : t('replay.friendly')} · {fmtDateTime(data.endedAt)}
          </p>
          {full && !full.verified && <p className="error">{t('replay.hashWarning')}</p>}
          <div className="actions">
            <button type="button" className="btn" onClick={() => setPly(0)} aria-label={t('replay.first')}>
              ⏮
            </button>
            <button type="button" className="btn" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label={t('replay.prev')}>
              ◀
            </button>
            <button type="button" className="btn" onClick={() => setPlaying((v) => !v)} aria-label={playing ? t('replay.pause') : t('replay.play')}>
              {playing ? '⏸' : '▶︎'}
            </button>
            <button type="button" className="btn" onClick={() => setPly((p) => Math.min(data.moves.length, p + 1))} aria-label={t('replay.next')}>
              ▶
            </button>
            <button type="button" className="btn" onClick={() => setPly(data.moves.length)} aria-label={t('replay.last')}>
              ⏭
            </button>
            <button type="button" className="btn" onClick={() => setFlipped((f) => !f)}>
              {t('common.flipBoard')}
            </button>
          </div>
          <p className="muted small">{t('replay.position', { ply, total: data.moves.length })}</p>
        </div>
        <div className="card grow">
          <MoveList moves={full?.game.history.map(moveText) ?? []} current={ply} onSelect={setPly} />
        </div>
      </aside>
    </div>
  );
}
