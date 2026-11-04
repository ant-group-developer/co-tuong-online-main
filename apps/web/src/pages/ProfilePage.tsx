/**
 * Hồ sơ: thống kê thắng/thua/hòa, rating, lịch sử trận + replay. Người khác chỉ thấy trận công khai.
 */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { END_REASON_VI, type EndReason } from '@xq/engine';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, NotConfigured, Spinner, Toast } from '../components/common';
import { errorVi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fb } from '../lib/firebase';

interface Stats {
  rating: number;
  peakRating: number;
  ratedGames: number;
  wins: number;
  losses: number;
  draws: number;
  friendlyGames: number;
  friendlyWins: number;
  friendlyLosses: number;
  friendlyDraws: number;
}

interface HistoryRow {
  matchId: string;
  color: 'red' | 'black';
  opponent: { uid: string; name: string };
  result: 'win' | 'loss' | 'draw' | 'aborted';
  reason: EndReason;
  mode: 'ranked' | 'friendly';
  rated: boolean;
  ratingBefore: number | null;
  ratingAfter: number | null;
  plies: number;
  endedAt: number;
}

const PAGE = 20;
const RESULT_VI = { win: 'Thắng', loss: 'Thua', draw: 'Hòa', aborted: 'Hủy' } as const;

export function ProfilePage() {
  const { uid: paramUid } = useParams();
  const auth = useAuth();
  const uid = paramUid ?? auth.user?.uid ?? null;
  const isMe = !!auth.user && uid === auth.user.uid;
  const [name, setName] = useState<string>('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const loadHistory = async (after: QueryDocumentSnapshot | null) => {
    if (!uid) return;
    const col = collection(fb().fs, 'players', uid, 'history');
    // Người khác: bắt buộc lọc visibility == public (khớp Security Rules).
    const base = isMe ? query(col, orderBy('endedAt', 'desc')) : query(col, where('visibility', '==', 'public'), orderBy('endedAt', 'desc'));
    const snap = await getDocs(after ? query(base, startAfter(after), limit(PAGE)) : query(base, limit(PAGE)));
    const list = snap.docs.map((d) => d.data() as HistoryRow);
    setHistory((h) => (after ? [...(h ?? []), ...list] : list));
    setCursor(snap.docs[snap.docs.length - 1] ?? null);
    setHasMore(snap.docs.length === PAGE);
  };

  useEffect(() => {
    if (!auth.configured || !auth.ready || !uid) return;
    (async () => {
      try {
        await auth.ensureSignedIn();
        const [p, s] = await Promise.all([getDoc(doc(fb().fs, 'publicProfiles', uid)), getDoc(doc(fb().fs, 'playerStats', uid))]);
        setName(String(p.get('displayName') ?? 'Kỳ thủ'));
        setEditName(String(p.get('displayName') ?? ''));
        setStats(s.exists() ? (s.data() as Stats) : null);
        await loadHistory(null);
      } catch (e) {
        setError(errorVi(e));
      }
    })();
  }, [auth.configured, auth.ready, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!auth.configured) return <NotConfigured />;
  if (!auth.ready) return <Spinner />;
  if (!uid)
    return (
      <ErrorState
        title="Bạn chưa đăng nhập"
        action={
          <Link className="btn primary" to="/login?next=/profile">
            Đăng nhập
          </Link>
        }
      />
    );
  if (error) return <ErrorState message={error} />;
  if (history === null) return <Spinner label="Đang tải hồ sơ…" />;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await auth.saveDisplayName(editName);
      setName(editName.trim());
      setToast('Đã lưu tên hiển thị');
    } catch (err) {
      setToast(errorVi(err));
    }
  };

  const winRate = stats && stats.ratedGames > 0 ? Math.round((stats.wins / stats.ratedGames) * 1000) / 10 : 0;
  return (
    <div className="page">
      <Toast message={toast} onClose={() => setToast(null)} />
      <h1>{isMe ? 'Hồ sơ của tôi' : name}</h1>
      {isMe && auth.isAnonymous && <p className="banner warn">Bạn đang dùng tài khoản khách. Đăng nhập để giữ thống kê và đấu xếp hạng.</p>}
      {isMe && (
        <form className="card row" onSubmit={saveName}>
          <label className="grow">
            Tên hiển thị
            <input value={editName} onChange={(e) => setEditName(e.target.value)} minLength={2} maxLength={24} required />
          </label>
          <button type="submit" className="btn">
            Lưu
          </button>
        </form>
      )}
      <div className="stat-grid">
        <div className="stat card">
          <small>Rating</small>
          <strong data-testid="profile-rating">{stats?.rating ?? 1200}</strong>
          <small className="muted">cao nhất {stats?.peakRating ?? 1200}</small>
        </div>
        <div className="stat card">
          <small>Trận xếp hạng</small>
          <strong>{stats?.ratedGames ?? 0}</strong>
          <small className="muted">
            T {stats?.wins ?? 0} · H {stats?.draws ?? 0} · B {stats?.losses ?? 0}
          </small>
        </div>
        <div className="stat card">
          <small>Tỉ lệ thắng (xếp hạng)</small>
          <strong>{winRate}%</strong>
          <small className="muted">thắng ÷ số trận</small>
        </div>
        <div className="stat card">
          <small>Giao hữu</small>
          <strong>{stats?.friendlyGames ?? 0}</strong>
          <small className="muted">
            T {stats?.friendlyWins ?? 0} · H {stats?.friendlyDraws ?? 0} · B {stats?.friendlyLosses ?? 0}
          </small>
        </div>
      </div>
      <h2 className="h3">Lịch sử trận {isMe ? '' : '(công khai)'}</h2>
      {history.length === 0 ? (
        <EmptyState title="Chưa có trận nào" />
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="history">
            <thead>
              <tr>
                <th scope="col">Thời gian</th>
                <th scope="col">Đối thủ</th>
                <th scope="col">Loại</th>
                <th scope="col">Kết quả</th>
                <th scope="col">Rating</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.matchId}>
                  <td>{new Date(h.endedAt).toLocaleString('vi-VN')}</td>
                  <td>
                    <Link to={`/profile/${h.opponent.uid}`}>{h.opponent.name}</Link> <small className="muted">({h.color === 'red' ? 'bạn Đỏ' : 'bạn Đen'})</small>
                  </td>
                  <td>{h.rated ? 'Xếp hạng' : 'Giao hữu'}</td>
                  <td className={`res-${h.result}`}>
                    {RESULT_VI[h.result]} <small className="muted">{END_REASON_VI[h.reason]}</small>
                  </td>
                  <td>
                    {h.rated && h.ratingAfter !== null && h.ratingBefore !== null
                      ? `${h.ratingAfter} (${h.ratingAfter - h.ratingBefore >= 0 ? '+' : ''}${h.ratingAfter - h.ratingBefore})`
                      : '—'}
                  </td>
                  <td>{h.result !== 'aborted' && <Link to={`/replay/${h.matchId}`}>Xem lại</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <button type="button" className="btn" onClick={() => void loadHistory(cursor).catch((e) => setError(errorVi(e)))}>
          Tải thêm
        </button>
      )}
    </div>
  );
}
