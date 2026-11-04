import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { envVar } from '../lib/env';

export const APP_NAME = envVar('VITE_APP_NAME') || 'Cờ Tướng Online';

export function Layout() {
  const auth = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const links = [
    { to: '/ai', label: 'Chơi với máy' },
    { to: '/ranked', label: 'Xếp hạng' },
    { to: '/online', label: 'Phòng & xem trận' },
    { to: '/leaderboard', label: 'Bảng xếp hạng' },
  ];
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
          {auth.configured &&
            (auth.user && !auth.isAnonymous ? (
              <>
                <NavLink to="/profile">{auth.displayName || 'Hồ sơ'}</NavLink>
                <button
                  type="button"
                  className="linklike"
                  onClick={async () => {
                    await auth.signOut();
                    nav('/');
                  }}
                >
                  Đăng xuất
                </button>
              </>
            ) : (
              <NavLink to="/login">{auth.user ? `${auth.displayName} · Đăng nhập` : 'Đăng nhập'}</NavLink>
            ))}
        </nav>
      </header>
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
