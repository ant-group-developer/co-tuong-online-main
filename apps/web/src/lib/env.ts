/**
 * Đọc cấu hình theo thứ tự:
 *  1. `window.__XQ_ENV__` – sinh lúc CHẠY bởi container Docker (`/env-config.js`, lấy từ biến môi trường / file .env);
 *  2. `import.meta.env` – Vite nhúng lúc BUILD (file `.env` ở thư mục gốc repo, dùng cho `npm run dev` và Firebase Hosting).
 * Nhờ vậy một image Docker dùng được cho mọi project: đổi .env rồi restart, không cần build lại.
 */
declare global {
  interface Window {
    __XQ_ENV__?: Record<string, string | undefined>;
  }
}

const runtime: Record<string, string | undefined> = (typeof window !== 'undefined' && window.__XQ_ENV__) || {};
const buildTime = import.meta.env as unknown as Record<string, string | undefined>;

export function envVar(key: string): string {
  const v = runtime[key];
  if (v !== undefined && v !== '') return v;
  return buildTime[key] ?? '';
}
