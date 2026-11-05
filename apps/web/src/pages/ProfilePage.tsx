/**
 * /profile – trang của tôi, 2 tab: "Hồ sơ" và "Đăng nhập" (khách) / "Tài khoản" (đã đăng nhập).
 * /profile/:uid – hồ sơ người khác (chỉ thấy trận công khai).
 */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import type { EndReason } from '@xq/engine';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AvatarPicker } from '../components/AvatarPicker';
import { EmptyState, ErrorState, NotConfigured, Spinner, Toast } from '../components/common';
import { fmtDateTime } from '../i18n';
import { errorText } from '../lib/api';
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

export function ProfilePage() {
  const { t } = useTranslation();
  const { uid: paramUid } = useParams();
  const auth = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  if (!auth.configured) return <NotConfigured />;
  if (!auth.ready || !auth.user) return <Spinner />;

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
      <h1>{auth.isAnonymous ? t('profile.guestTitle') : t('profile.myTitle')}</h1>
      <div className="tabs" role="tablist" aria-label={t('profile.tabs')}>
        <button type="button" role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'active' : ''} onClick={() => goTab('profile')} data-testid="tab-profile">
          {t('profile.tabProfile')}
        </button>
        <button type="button" role="tab" aria-selected={tab === second} className={tab === second ? 'active' : ''} onClick={() => goTab(second)} data-testid={`tab-${second}`}>
          {auth.isAnonymous ? t('profile.tabLogin') : t('profile.tabAccount')}
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
  const { t } = useTranslation();
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
        setError(errorText(e));
      }
    })();
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState message={error} />;
  if (history === null) return <Spinner label={t('profile.loading')} />;

  const shownName = isMe ? auth.displayName : name;
  const guest = isMe ? auth.isAnonymous : isGuest;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await auth.saveDisplayName(editName);
      setEditing(false);
      setToast(t('profile.nameSaved'));
    } catch (err) {
      setToast(errorText(err));
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
                aria-label={t('profile.nameLabel')}
                data-testid="name-input"
              />
              <button type="submit" className="btn primary" disabled={saving} data-testid="name-save">
                {t('common.save')}
              </button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                {t('common.cancel')}
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
                  {t('profile.rename')}
                </button>
              )}
            </div>
          )}
          <div className="row">
            <span className="muted small">
              {t('profile.id')}: <code data-testid="profile-code">{code}</code>
            </span>
            <span className={`badge${guest ? '' : ' ok'}`}>{guest ? t('profile.guest') : t('profile.member')}</span>
          </div>
        </div>
      </section>
      {isMe && guest && (
        <p className="muted small">
          {t('profile.guestNote')}
        </p>
      )}
      {isMe && <AvatarPicker onSaved={setToast} />}
      <div className="stat-grid">
        <div className="stat card">
          <small>{t('profile.rating')}</small>
          <strong data-testid="profile-rating">{stats?.rating ?? 1200}</strong>
          <small className="muted">{t('profile.peak', { n: stats?.peakRating ?? 1200 })}</small>
        </div>
        <div className="stat card">
          <small>{t('profile.rankedGames')}</small>
          <strong>{stats?.ratedGames ?? 0}</strong>
          <small className="muted">{t('profile.wdlShort', { w: stats?.wins ?? 0, d: stats?.draws ?? 0, l: stats?.losses ?? 0 })}</small>
        </div>
        <div className="stat card">
          <small>{t('profile.winRate')}</small>
          <strong>{winRate}%</strong>
          <small className="muted">{t('profile.winRateNote')}</small>
        </div>
        <div className="stat card">
          <small>{t('profile.friendly')}</small>
          <strong>{stats?.friendlyGames ?? 0}</strong>
          <small className="muted">
            {t('profile.wdlShort', { w: stats?.friendlyWins ?? 0, d: stats?.friendlyDraws ?? 0, l: stats?.friendlyLosses ?? 0 })}
          </small>
        </div>
      </div>
      <section className="stack">
        <h2 className="h3">{isMe ? t('profile.history') : t('profile.historyPublic')}</h2>
        {history.length === 0 ? (
          <EmptyState title={t('profile.noGames')} />
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="history">
              <thead>
                <tr>
                  <th scope="col">{t('profile.time')}</th>
                  <th scope="col">{t('profile.opponent')}</th>
                  <th scope="col">{t('profile.type')}</th>
                  <th scope="col">{t('profile.result')}</th>
                  <th scope="col">{t('profile.ratingCol')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.matchId}>
                    <td>{fmtDateTime(h.endedAt)}</td>
                    <td>
                      <Link to={`/profile/${h.opponent.uid}`}>{h.opponent.name}</Link>{' '}
                      <small className="muted">({h.color === 'red' ? t('profile.playedRed') : t('profile.playedBlack')})</small>
                    </td>
                    <td>{h.rated ? t('profile.rankedType') : t('profile.friendlyType')}</td>
                    <td className={`res-${h.result}`}>
                      {t(`profile.res_${h.result}`)} <small className="muted">{t(`endReason.${h.reason}`)}</small>
                    </td>
                    <td>
                      {h.rated && h.ratingAfter !== null && h.ratingBefore !== null
                        ? `${h.ratingAfter} (${h.ratingAfter - h.ratingBefore >= 0 ? '+' : ''}${h.ratingAfter - h.ratingBefore})`
                        : '—'}
                    </td>
                    <td>{h.result !== 'aborted' && <Link to={`/replay/${h.matchId}`}>{t('common.replay')}</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div className="row">
            <button type="button" className="btn" onClick={() => void loadHistory(cursor).catch((e) => setError(errorText(e)))}>
              {t('common.loadMore')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
