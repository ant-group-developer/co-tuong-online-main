import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { envVar } from '../lib/env';
import { ROOM_STATUS_VI, useMyActiveRoom } from '../lib/myroom';

export const APP_NAME = envVar('VITE_APP_NAME') || 'Cờ Tướng Online';

/** Thanh nhắc "bạn đang ở phòng X" trên mọi trang (trừ chính phòng đó). */
function ActiveRoomBar() {
  const my = useMyActiveRoom();
  const loc = useLocation();
  // Trang sảnh /online đã có thẻ "Bạn đang ở phòng" riêng.
  if (!my || loc.pathname === `/room/${my.roomId}` || loc.pathname === '/online') return null;
  return (
    <div className="active-room-bar" role="status" data-testid="active-room-bar">
      <span>
        Bạn đang ở {my.mode === 'ranked' ? 'trận xếp hạng' : 'phòng'} <strong>{my.roomId}</strong> · {ROOM_STATUS_VI[my.status]}
      </span>
      <Link className="btn primary small" to={`/room/${my.roomId}`} data-testid="back-to-room">
        Quay lại phòng
      </Link>
    </div>
  );
}

export function Layout() {
  const auth = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const links = [
    { to: '/ai', label: 'Chơi với máy' },
    { to: '/ranked', label: 'Xếp hạng' },
    { to: '/online', label: 'Phòng & xem trận' },
    { to: '/leaderboard', label: 'Bảng xếp hạng' },
  ];
  const onProfile = loc.pathname === '/profile';
  const loginTab = onProfile && new URLSearchParams(loc.search).get('tab') === 'login';
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Bỏ qua tới nội dung
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label={`${APP_NAME} – Trang chủ`}>
          <img src="/logo.png" alt="" width={36} height={36} />
          <span>{APP_NAME}</span>
        </Link>
        <button type="button" className="btn btn-icon menu-toggle" aria-expanded={open} aria-label="Mở menu" onClick={() => setOpen((v) => !v)}>
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
              {auth.displayName || 'Hồ sơ'}
            </Link>
          )}
          {auth.configured && auth.isAnonymous && (
            <Link to="/profile?tab=login" className={loginTab ? 'active' : ''}>
              Đăng nhập
            </Link>
          )}
        </nav>
      </header>
      <ActiveRoomBar />
      <main id="main" className="main">
        <Outlet />
      </main>
      <footer className="footer">
        <span>© {new Date().getFullYear()} {APP_NAME}</span>
        <span className="muted">Luật: xq-rules-v1 (giản lược, xem Hướng dẫn)</span>
        <Link to="/rules">Luật & chính sách</Link>
      </footer>
    </div>
  );
}
