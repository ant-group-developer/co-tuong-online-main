/**
 * Kiểm tra đa ngôn ngữ:
 *  - vi và en có đúng cùng bộ khóa, không có bản dịch rỗng (trừ các "hint" được phép rỗng).
 *  - Mọi khóa thông báo của server (functions/src/messages.ts) đều có bản dịch.
 *  - Biến {{x}} trong vi và en khớp nhau.
 *  - Không còn chữ tiếng Việt viết thẳng trong code giao diện (ngoài thư mục i18n và chú thích).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MSG } from '../../functions/src/messages';
import { en } from '../../apps/web/src/i18n/en';
import { vi } from '../../apps/web/src/i18n/vi';

type Tree = { [k: string]: string | Tree };

function flatten(t: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const fv = flatten(vi as unknown as Tree);
const fe = flatten(en as unknown as Tree);
const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('vi và en có cùng bộ khóa, không bỏ trống', () => {
    expect(Object.keys(fe).sort()).toEqual(Object.keys(fv).sort());
    const emptyAllowed = (k: string) => k.endsWith('.hint');
    for (const [k, v] of Object.entries(fv)) if (!emptyAllowed(k)) expect(v, `vi:${k}`).not.toBe('');
    for (const [k, v] of Object.entries(fe)) if (!emptyAllowed(k)) expect(v, `en:${k}`).not.toBe('');
  });

  it('biến {{…}} giống nhau giữa hai ngôn ngữ', () => {
    for (const k of Object.keys(fv)) expect(vars(fe[k]), k).toEqual(vars(fv[k]));
  });

  it('mọi thông báo của server đều có bản dịch', () => {
    for (const key of Object.keys(MSG)) {
      expect(fv[`serverErrors.${key}`], `vi serverErrors.${key}`).toBeTruthy();
      expect(fe[`serverErrors.${key}`], `en serverErrors.${key}`).toBeTruthy();
    }
  });

  it('không còn chữ tiếng Việt viết thẳng trong code giao diện', () => {
    const root = path.resolve(__dirname, '../../apps/web/src');
    const VN = /[ạảãáàâầấậẩẫăằắặẳẵđêềếệểễôồốộổỗơờớợởỡưừứựửữĐ]/;
    // Thông báo kỹ thuật cho lập trình viên (không hiển thị cho người chơi)
    const allow = [/useAuth ngoài AuthProvider/];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== 'i18n') walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const src = readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '') // chú thích khối (kể cả {/* */} trong JSX)
          .replace(/(^|[^:'"`])\/\/.*$/gm, '$1'); // chú thích dòng
        src.split('\n').forEach((line, i) => {
          if (VN.test(line) && !allow.some((a) => a.test(line))) offenders.push(`${path.relative(root, p)}:${i + 1}: ${line.trim()}`);
        });
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
