/**
 * Tab "Đăng nhập" (khách) và tab "Tài khoản" (đã đăng nhập) của trang /profile.
 */
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { authErrorText, useAuth } from '../lib/auth';

export function LoginPanel({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
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
      setError(authErrorText(e));
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
        <Trans i18nKey="login.guestBanner" values={{ name: auth.displayName, code: auth.code }} components={{ b: <strong />, code: <code /> }} />
      </p>
      <div className="card stack">
        <h2 className="h3">{t('login.quick')}</h2>
        <button type="button" className="btn big google" disabled={busy} onClick={() => run(auth.signInGoogle)} data-testid="login-google">
          {t('login.google')}
        </button>
      </div>
      <form className="card stack" onSubmit={submit} aria-label={t('login.emailForm')}>
        <div className="tabs small-tabs" role="tablist" aria-label={t('login.emailTabs')}>
          <button type="button" role="tab" aria-selected={mode === 'in'} className={mode === 'in' ? 'active' : ''} onClick={() => setMode('in')} data-testid="login-mode-in">
            {t('login.signInEmail')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'active' : ''} onClick={() => setMode('up')} data-testid="login-toggle">
            {t('login.signUp')}
          </button>
        </div>
        {mode === 'up' && (
          <label>
            {t('login.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={24} required autoComplete="nickname" />
          </label>
        )}
        <label>
          {t('login.email')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" data-testid="login-email" />
        </label>
        <label>
          {t('login.password')}
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
        {mode === 'in' && <p className="muted small">{t('login.switchNote')}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy} data-testid="login-submit">
            {mode === 'in' ? t('login.submitIn') : t('login.submitUp')}
          </button>
        </div>
      </form>
    </div>
  );
}

const PROVIDER_KEY: Record<string, 'login.provider_google' | 'login.provider_password' | 'login.provider_anonymous'> = {
  'google.com': 'login.provider_google',
  password: 'login.provider_password',
  anonymous: 'login.provider_anonymous',
};

export function AccountPanel({ onSignedOut }: { onSignedOut: () => void }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <div className="card stack">
      <h2 className="h3">{t('login.account')}</h2>
      <dl className="kv">
        <dt>{t('login.signedInWith')}</dt>
        <dd>{PROVIDER_KEY[auth.provider] ? t(PROVIDER_KEY[auth.provider]) : auth.provider}</dd>
        {auth.email && (
          <>
            <dt>{t('login.email')}</dt>
            <dd>{auth.email}</dd>
          </>
        )}
        <dt>{t('login.playerId')}</dt>
        <dd>
          <code>{auth.code}</code>
        </dd>
      </dl>
      <p className="muted small">{t('login.signOutNote')}</p>
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
          {t('login.signOut')}
        </button>
      </div>
    </div>
  );
}
