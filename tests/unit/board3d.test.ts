/**
 * Bàn 3D: nhận biết nước đi để diễn hoạt cảnh, danh sách nhân vật và bản dịch.
 */
import { Game, makeMove, sqOf } from '@xq/engine';
import { describe, expect, it } from 'vitest';
import { AI_AVATAR, AVATAR_IDS, AVATAR_SWATCH, isAvatarId, isEmoteId } from '../../apps/web/src/lib/avatars';
import { isSingleMove, sameBoard } from '../../apps/web/src/three/diff';
import { en } from '../../apps/web/src/i18n/en';
import { vi } from '../../apps/web/src/i18n/vi';

describe('isSingleMove', () => {
  it('nhận đúng một nước thường và một nước ăn quân', () => {
    const g = new Game();
    const before = Array.from(g.position.board);
    const m = makeMove(sqOf(7, 7), sqOf(7, 4)); // pháo 2 bình 5
    g.play(m);
    const after = Array.from(g.position.board);
    expect(isSingleMove(before, after, { from: sqOf(7, 7), to: sqOf(7, 4) })).toBe(true);
    // nước khác với lastMove => không diễn hoạt cảnh
    expect(isSingleMove(before, after, { from: sqOf(7, 1), to: sqOf(7, 4) })).toBe(false);
    // pháo ăn mã: ô đích đang có quân đối phương
    const g2 = new Game();
    const b2 = Array.from(g2.position.board);
    g2.play(makeMove(sqOf(7, 1), sqOf(0, 1)));
    expect(isSingleMove(b2, Array.from(g2.position.board), { from: sqOf(7, 1), to: sqOf(0, 1) })).toBe(true);
  });

  it('lùi nước / đồng bộ lại / ván mới => không phải một nước', () => {
    const g = new Game();
    const start = Array.from(g.position.board);
    g.play(makeMove(sqOf(7, 7), sqOf(7, 4)));
    g.play(makeMove(sqOf(0, 1), sqOf(2, 2)));
    const two = Array.from(g.position.board);
    expect(isSingleMove(start, two, { from: sqOf(0, 1), to: sqOf(2, 2) })).toBe(false);
    expect(isSingleMove(two, start, { from: sqOf(7, 4), to: sqOf(7, 7) })).toBe(false);
    expect(sameBoard(start, start.slice())).toBe(true);
    expect(sameBoard(start, two)).toBe(false);
  });
});

describe('nhân vật 3D', () => {
  it('mỗi mức máy có nhân vật hợp lệ; id ngoài danh sách bị từ chối', () => {
    for (const a of Object.values(AI_AVATAR)) expect(isAvatarId(a)).toBe(true);
    expect(isAvatarId('lan')).toBe(false);
    expect(isAvatarId(null)).toBe(false);
    expect(isEmoteId('wave')).toBe(true);
    expect(isEmoteId('rude')).toBe(false);
  });

  it('có màu và bản dịch tên/mô tả cho mọi nhân vật ở cả hai ngôn ngữ', () => {
    for (const id of AVATAR_IDS) {
      expect(AVATAR_SWATCH[id].robe).toMatch(/^#[0-9a-f]{6}$/);
      expect(vi.avatars[id].name.length).toBeGreaterThan(1);
      expect(en.avatars[id].name.length).toBeGreaterThan(1);
    }
  });

  it('danh sách nhân vật và biểu cảm khớp với Security Rules', async () => {
    const { readFileSync } = await import('node:fs');
    const fsRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const listed = /d\.avatar in \[([^\]]+)\]/.exec(fsRules)?.[1].match(/'(\w+)'/g)?.map((s) => s.slice(1, -1));
    expect(listed?.sort()).toEqual([...AVATAR_IDS].sort());
    const dbRules = readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8');
    expect(dbRules).toContain('^(wave|happy|thinking)$');
  });
});
