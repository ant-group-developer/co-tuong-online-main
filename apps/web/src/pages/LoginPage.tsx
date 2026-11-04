import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { NotConfigured } from '../components/common';
import { authErrorVi, useAuth } from '../lib/auth';

export function LoginPage() {
  const auth = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/';
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!auth.configured) return <NotConfigured />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      nav(next, { replace: true });
    } catch (e) {
      setError(authErrorVi(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => (mode === 'in' ? auth.signInEmail(email, password) : auth.signUpEmail(email, password, name)));
  };

  return (
    <div className="page narrow">
      <h1>{mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}</h1>
      {auth.user && !auth.isAnonymous && (
        <p className="banner">
          Bạn đang đăng nhập là <strong>{auth.displayName}</strong>. <Link to="/profile">Xem hồ sơ</Link>
        </p>
      )}
      <div className="card">
        <button type="button" className="btn big google" disabled={busy} onClick={() => run(auth.signInGoogle)}>
          Tiếp tục với Google
        </button>
      </div>
      <form className="card" onSubmit={submit} aria-label="Đăng nhập bằng email">
        {mode === 'up' && (
          <label>
            Tên hiển thị
            <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={24} required autoComplete="nickname" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" data-testid="login-email" />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            data-testid="login-password"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy} data-testid="login-submit">
          {mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}
        </button>
        <button type="button" className="linklike" onClick={() => setMode(mode === 'in' ? 'up' : 'in')} data-testid="login-toggle">
          {mode === 'in' ? 'Chưa có tài khoản? Tạo mới' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      </form>
      <p className="muted small">
        Khách có thể <Link to="/ai">chơi với máy</Link>, xem trận và chơi phòng bạn bè mà không cần tài khoản. Đấu xếp hạng cần tài khoản.
      </p>
    </div>
  );
}
