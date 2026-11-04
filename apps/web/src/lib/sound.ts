/**
 * Âm thanh tổng hợp bằng WebAudio (không dùng file âm thanh của bản tham chiếu).
 * AudioContext chỉ được tạo/khôi phục sau thao tác người dùng (chính sách autoplay của trình duyệt).
 */
type SoundKind = 'move' | 'capture' | 'check' | 'end' | 'notify';

const KEY = 'xq.sound';
interface SoundPrefs {
  enabled: boolean;
  volume: number; // 0..1
}

function load(): SoundPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (typeof v?.enabled === 'boolean' && typeof v?.volume === 'number') return v;
  } catch {
    /* bỏ qua */
  }
  return { enabled: true, volume: 0.6 };
}

let prefs = load();
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

export function getSoundPrefs(): SoundPrefs {
  return prefs;
}

export function setSoundPrefs(p: Partial<SoundPrefs>): void {
  prefs = { ...prefs, ...p, volume: Math.min(1, Math.max(0, p.volume ?? prefs.volume)) };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* bỏ qua */
  }
  listeners.forEach((l) => l());
}

export function subscribeSound(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Gọi trong handler thao tác người dùng để mở khóa âm thanh. */
export function unlockAudio(): void {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

if (typeof window !== 'undefined') {
  const once = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

function knock(at: number, freq: number, dur: number, gain: number): void {
  if (!ctx) return;
  // Tiếng "cạch" gỗ: nhiễu lọc dải + sóng sin ngắn.
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 3;
  const g = ctx.createGain();
  g.gain.value = gain * prefs.volume;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(at);
}

function tone(at: number, freq: number, dur: number, gain: number): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain * prefs.volume, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export function playSound(kind: SoundKind): void {
  if (!prefs.enabled || prefs.volume <= 0 || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.005;
  switch (kind) {
    case 'move':
      knock(t, 1800, 0.08, 1.4);
      break;
    case 'capture':
      knock(t, 1400, 0.09, 1.6);
      knock(t + 0.07, 900, 0.12, 1.4);
      break;
    case 'check':
      knock(t, 1800, 0.08, 1.2);
      tone(t + 0.05, 880, 0.25, 0.25);
      tone(t + 0.12, 1320, 0.3, 0.2);
      break;
    case 'end':
      tone(t, 523, 0.5, 0.2);
      tone(t + 0.12, 659, 0.5, 0.18);
      tone(t + 0.24, 784, 0.7, 0.18);
      break;
    case 'notify':
      tone(t, 988, 0.18, 0.15);
      break;
  }
}
