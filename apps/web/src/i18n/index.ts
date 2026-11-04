/**
 * Đa ngôn ngữ (i18next + react-i18next).
 * - Ngôn ngữ: lựa chọn đã lưu (localStorage) > ngôn ngữ trình duyệt (vi* => vi, còn lại => en).
 * - Thêm ngôn ngữ: tạo file `xx.ts` kiểu `Messages` (cùng bộ khóa với vi.ts), thêm vào LANGS + resources.
 * - Ký hiệu nước đi theo ngôn ngữ: vi => kiểu Việt (P2-5), en => quốc tế WXF (C2=5).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { vi } from './vi';

export const LANGS = ['vi', 'en'] as const;
export type Lang = (typeof LANGS)[number];

const STORAGE_KEY = 'xq.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  } catch {
    /* localStorage bị chặn */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language ?? '' : '';
  return nav.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

function applyDocument(lang: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  const t = i18n.getFixedT(lang);
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}

void i18n.use(initReactI18next).init({
  resources: { vi: { translation: vi }, en: { translation: en } },
  lng: detect(),
  fallbackLng: 'vi',
  supportedLngs: [...LANGS],
  interpolation: { escapeValue: false }, // React tự escape
  // Khóa có dấu "_" (not_found, super_easy…) không phải "ngữ cảnh": đổi ký tự tách ngữ cảnh.
  contextSeparator: '§',
  returnNull: false,
});
applyDocument(i18n.language);
i18n.on('languageChanged', applyDocument);

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* bỏ qua */
  }
  void i18n.changeLanguage(lang);
}

export function currentLang(): Lang {
  return (LANGS as readonly string[]).includes(i18n.language) ? (i18n.language as Lang) : 'vi';
}

const LOCALE: Record<Lang, string> = { vi: 'vi-VN', en: 'en-GB' };

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(LOCALE[currentLang()]);
}

export function fmtNumber(n: number, digits?: number): string {
  return n.toLocaleString(LOCALE[currentLang()], digits === undefined ? undefined : { maximumFractionDigits: digits });
}

/** Ký hiệu nước đi theo ngôn ngữ hiện tại. */
export function moveText(h: { vn: string; wxf: string }): string {
  return currentLang() === 'vi' ? h.vn : h.wxf;
}

export default i18n;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    contextSeparator: '§';
    resources: { translation: typeof vi };
  }
}
