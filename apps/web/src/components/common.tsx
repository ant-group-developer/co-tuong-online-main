import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getSoundPrefs, setSoundPrefs, subscribeSound } from '../lib/sound';

export function Spinner({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ title = 'Đã có lỗi', message, action }: { title?: string; message?: string; action?: ReactNode }) {
  return (
    <div className="state state-error" role="alert">
      <strong>{title}</strong>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="state state-empty">
      <strong>{title}</strong>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function NotConfigured() {
  return (
    <ErrorState
      title="Chế độ online chưa được cấu hình"
      message="Chưa có cấu hình Firebase (biến VITE_FIREBASE_*) hoặc chế độ emulator. Bạn vẫn có thể chơi với máy. Xem docs/HUONG-DAN-CAU-HINH-FIREBASE.md."
      action={
        <Link className="btn" to="/ai">
          Chơi với máy
        </Link>
      }
    />
  );
}

export function useNow(intervalMs = 250, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

export function formatClock(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 10_000) return `${Math.floor(v / 1000)}.${Math.floor((v % 1000) / 100)}`;
  const total = Math.ceil(v / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SoundControl() {
  const [p, setP] = useState(getSoundPrefs());
  useEffect(() => subscribeSound(() => setP(getSoundPrefs())), []);
  return (
    <div className="sound-control">
      <button
        type="button"
        className="btn btn-icon"
        aria-pressed={p.enabled}
        aria-label={p.enabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
        title={p.enabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
        onClick={() => setSoundPrefs({ enabled: !p.enabled })}
      >
        {p.enabled ? '🔊' : '🔇'}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(p.volume * 100)}
        aria-label="Âm lượng"
        disabled={!p.enabled}
        onChange={(e) => setSoundPrefs({ volume: Number(e.target.value) / 100 })}
      />
    </div>
  );
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(id);
  }, [message, onClose]);
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite" onClick={onClose}>
      {message}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
