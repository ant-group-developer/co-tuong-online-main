/**
 * /profile – trang của tôi, 2 tab: "Hồ sơ" và "Đăng nhập" (khách) / "Tài khoản" (đã đăng nhập).
 * /profile/:uid – hồ sơ người khác (chỉ thấy trận công khai).
 */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { END_REASON_VI, type EndReason } from '@xq/engine';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, NotConfigured, Spinner, Toast } from '../components/common';
import { errorVi } from '../lib/api';
import { codeOf, useAuth } from '../lib/auth';
import { fb } from '../lib/firebase';
import { AccountPanel, LoginPanel } from './LoginPage';

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
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  if (!auth.configured) return <NotConfigured />;
  if (!auth.ready || !auth.user) return <Spinner label="Đang tải…" />;

  // Hồ sơ người khác
  if (paramUid && paramUid !== auth.user.uid)
    return (
      <div className="page narrow-wide">
        <ProfileView key={paramUid} uid={paramUid} isMe={false} />
      </div>
    );
  if (paramUid) return <Navigate to="/profile" replace />;

  const second = auth.isAnonymous ? 'login' : 'account';
  const tab = params.get('tab') === second ? second : 'profile';
  const next = params.get('next');
  const goTab = (t: string) => {
    const p = new URLSearchParams(params);
    if (t === 'profile') p.delete('tab');
    else p.set('tab', t);
    setParams(p, { replace: true });
  };

  return (
    <div className="page narrow-wide">
      <h1>{auth.isAnonymous ? 'Hồ sơ khách' : 'Hồ sơ của tôi'}</h1>
      <div className="tabs" role="tablist" aria-label="Hồ sơ">
        <button type="button" role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'active' : ''} onClick={() => goTab('profile')} data-testid="tab-profile">
          Hồ sơ
        </button>
        <button type="button" role="tab" aria-selected={tab === second} className={tab === second ? 'active' : ''} onClick={() => goTab(second)} data-testid={`tab-${second}`}>
          {auth.isAnonymous ? 'Đăng nhập' : 'Tài khoản'}
        </button>
      </div>
      <div className="tab-panel" role="tabpanel">
        {tab === 'profile' ? (
          <ProfileView key={auth.user.uid} uid={auth.user.uid} isMe />
        ) : tab === 'login' ? (
          <LoginPanel onDone={() => (next?.startsWith('/') ? nav(next, { replace: true }) : goTab('profile'))} />
        ) : (
          <AccountPanel onSignedOut={() => goTab('profile')} />
        )}
      </div>
    </div>
  );
}

function ProfileView({ uid, isMe }: { uid: string; isMe: boolean }) {
  const auth = useAuth();
  const [name, setName] = useState('');
  const [code, setCode] = useState(codeOf(uid));
  const [isGuest, setIsGuest] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadHistory = async (after: QueryDocumentSnapshot | null) => {
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
    (async () => {
      try {
        const [p, s] = await Promise.all([getDoc(doc(fb().fs, 'publicProfiles', uid)), getDoc(doc(fb().fs, 'playerStats', uid))]);
        setName(String(p.get('displayName') ?? 'Kỳ thủ'));
        setCode(String(p.get('code') ?? codeOf(uid)));
        setIsGuest(p.get('isGuest') === true);
        setStats(s.exists() ? (s.data() as Stats) : null);
        await loadHistory(null);
      } catch (e) {
        setError(errorVi(e));
      }
    })();
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState message={error} />;
  if (history === null) return <Spinner label="Đang tải hồ sơ…" />;

  const shownName = isMe ? auth.displayName : name;
  const guest = isMe ? auth.isAnonymous : isGuest;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await auth.saveDisplayName(editName);
      setEditing(false);
      setToast('Đã lưu tên hiển thị');
    } catch (err) {
      setToast(errorVi(err));
    } finally {
      setSaving(false);
    }
  };

  const winRate = stats && stats.ratedGames > 0 ? Math.round((stats.wins / stats.ratedGames) * 1000) / 10 : 0;
  return (
    <div className="stack">
      <Toast message={toast} onClose={() => setToast(null)} />
      <section className="card profile-head">
        <span className="profile-avatar" aria-hidden="true">
          {shownName.slice(0, 1).toUpperCase() || '?'}
        </span>
        <div className="profile-id">
          {editing ? (
            <form className="row" onSubmit={saveName}>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                minLength={2}
                maxLength={24}
                required
                autoFocus
                aria-label="Tên hiển thị"
                data-testid="name-input"
              />
              <button type="submit" className="btn primary" disabled={saving} data-testid="name-save">
                Lưu
              </button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Hủy
              </button>
            </form>
          ) : (
            <div className="row">
              <strong className="profile-name" data-testid="profile-name">
                {shownName}
              </strong>
              {isMe && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setEditName(shownName);
                    setEditing(true);
                  }}
                  data-testid="name-edit"
                >
                  Đổi tên
                </button>
              )}
            </div>
          )}
          <div className="row">
            <span className="muted small">
              ID: <code data-testid="profile-code">{code}</code>
            </span>
            <span className={`badge${guest ? '' : ' ok'}`}>{guest ? 'Khách' : 'Thành viên'}</span>
          </div>
        </div>
      </section>
      {isMe && guest && (
        <p className="muted small">
          Tài khoản khách gắn với trình duyệt này. Xóa dữ liệu trình duyệt sẽ mất tài khoản – hãy đăng nhập (tab "Đăng nhập") để giữ lâu dài.
        </p>
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
      <section className="stack">
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
                      <Link to={`/profile/${h.opponent.uid}`}>{h.opponent.name}</Link>{' '}
                      <small className="muted">({h.color === 'red' ? 'cầm Đỏ' : 'cầm Đen'})</small>
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
          <div className="row">
            <button type="button" className="btn" onClick={() => void loadHistory(cursor).catch((e) => setError(errorVi(e)))}>
              Tải thêm
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
