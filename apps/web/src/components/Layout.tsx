import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LANGS, setLang, type Lang } from '../i18n';
import { useAuth } from '../lib/auth';
import { envVar } from '../lib/env';
import { useMyActiveRoom } from '../lib/myroom';

/** Tên ứng dụng: VITE_APP_NAME (nếu đặt) hoặc tên theo ngôn ngữ. */
export function useAppName(): string {
  const { t } = useTranslation();
  return envVar('VITE_APP_NAME') || t('meta.title');
}

/** Thanh nhắc "bạn đang ở phòng X" trên mọi trang (trừ chính phòng đó và sảnh). */
function ActiveRoomBar() {
  const { t } = useTranslation();
  const my = useMyActiveRoom();
  const loc = useLocation();
  if (!my || loc.pathname === `/room/${my.roomId}` || loc.pathname === '/online') return null;
  return (
    <div className="active-room-bar" role="status" data-testid="active-room-bar">
      <span>
        <Trans
          i18nKey={my.mode === 'ranked' ? 'nav.activeRanked' : 'nav.activeRoom'}
          values={{ roomId: my.roomId, status: t(`roomStatus.${my.status}`) }}
          components={{ b: <strong /> }}
        />
      </span>
      <Link className="btn primary small" to={`/room/${my.roomId}`} data-testid="back-to-room">
        {t('nav.backToRoom')}
      </Link>
    </div>
  );
}

export function LangSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {LANGS.map((l: Lang) => (
        <button
          key={l}
          type="button"
          className={i18n.language === l ? 'active' : ''}
          aria-pressed={i18n.language === l}
          title={t(`lang.${l}`)}
          onClick={() => setLang(l)}
          data-testid={`lang-${l}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation();
  const auth = useAuth();
  const loc = useLocation();
  const appName = useAppName();
  const [open, setOpen] = useState(false);
  const links = [
    { to: '/ai', label: t('nav.ai') },
    { to: '/ranked', label: t('nav.ranked') },
    { to: '/online', label: t('nav.online') },
    { to: '/leaderboard', label: t('nav.leaderboard') },
    { to: '/rules', label: t('nav.rules') },
  ];
  const onProfile = loc.pathname === '/profile';
  const loginTab = onProfile && new URLSearchParams(loc.search).get('tab') === 'login';
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('nav.skip')}
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label={`${appName} – ${t('nav.home')}`}>
          <img src="/logo.png" alt="" width={36} height={36} />
          <span>{appName}</span>
        </Link>
        <button type="button" className="btn btn-icon menu-toggle" aria-expanded={open} aria-label={t('nav.openMenu')} onClick={() => setOpen((v) => !v)}>
          ☰
        </button>
        <nav className={`nav${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
          {auth.configured && auth.user && (
            <Link to="/profile" className={`nav-user${onProfile && !loginTab ? ' active' : ''}`} data-testid="nav-profile">
              <span className="nav-avatar" aria-hidden="true">
                {auth.displayName.slice(0, 1).toUpperCase() || '?'}
              </span>
              <span className="nav-user-name" title={auth.displayName || undefined}>
                {auth.displayName || t('nav.profile')}
              </span>
            </Link>
          )}
          {auth.configured && auth.isAnonymous && (
            <Link to="/profile?tab=login" className={loginTab ? 'active' : ''}>
              {t('nav.signIn')}
            </Link>
          )}
          <LangSwitch />
        </nav>
      </header>
      <ActiveRoomBar />
      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}
