/**
 * Tab "Đăng nhập" (khách) và tab "Tài khoản" (đã đăng nhập) của trang /profile.
 */
import { useState, type FormEvent } from 'react';
import { authErrorVi, useAuth } from '../lib/auth';

export function LoginPanel({ onDone }: { onDone: () => void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
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
    <div className="stack">
      <p className="banner">
        Bạn đang chơi bằng tài khoản khách <strong>{auth.displayName}</strong> (ID <code>{auth.code}</code>). Đăng nhập bằng Google hoặc tạo
        tài khoản email sẽ <strong>giữ nguyên ID, rating và lịch sử</strong> này, và dùng được trên máy khác.
      </p>
      <div className="card stack">
        <h2 className="h3">Đăng nhập nhanh</h2>
        <button type="button" className="btn big google" disabled={busy} onClick={() => run(auth.signInGoogle)} data-testid="login-google">
          Tiếp tục với Google
        </button>
      </div>
      <form className="card stack" onSubmit={submit} aria-label="Đăng nhập bằng email">
        <div className="tabs small-tabs" role="tablist" aria-label="Email">
          <button type="button" role="tab" aria-selected={mode === 'in'} className={mode === 'in' ? 'active' : ''} onClick={() => setMode('in')} data-testid="login-mode-in">
            Đăng nhập email
          </button>
          <button type="button" role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'active' : ''} onClick={() => setMode('up')} data-testid="login-toggle">
            Tạo tài khoản
          </button>
        </div>
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
        {mode === 'in' && <p className="muted small">Đăng nhập vào tài khoản email đã có sẽ chuyển sang tài khoản đó (dữ liệu khách hiện tại không được gộp).</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy} data-testid="login-submit">
            {mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}
          </button>
        </div>
      </form>
    </div>
  );
}

const PROVIDER_VI: Record<string, string> = { 'google.com': 'Google', password: 'Email', anonymous: 'Khách' };

export function AccountPanel({ onSignedOut }: { onSignedOut: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <div className="card stack">
      <h2 className="h3">Tài khoản</h2>
      <dl className="kv">
        <dt>Đăng nhập bằng</dt>
        <dd>{PROVIDER_VI[auth.provider] ?? auth.provider}</dd>
        {auth.email && (
          <>
            <dt>Email</dt>
            <dd>{auth.email}</dd>
          </>
        )}
        <dt>ID người chơi</dt>
        <dd>
          <code>{auth.code}</code>
        </dd>
      </dl>
      <p className="muted small">Sau khi đăng xuất, trình duyệt này sẽ dùng một tài khoản khách mới.</p>
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={busy}
          data-testid="sign-out"
          onClick={async () => {
            setBusy(true);
            try {
              await auth.signOut();
              onSignedOut();
            } finally {
              setBusy(false);
            }
          }}
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
