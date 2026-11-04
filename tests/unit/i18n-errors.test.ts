/**
 * Thông báo lỗi từ server được dịch theo ngôn ngữ đang chọn nhờ khóa `details.key` / `messageKey`.
 */
import { describe, expect, it } from 'vitest';
import { keyOfMessage, MSG } from '../../functions/src/messages';
import i18n, { setLang } from '../../apps/web/src/i18n';
import { commandText, errorText } from '../../apps/web/src/lib/api';

describe('dịch lỗi server', () => {
  it('server: câu tiếng Việt -> khóa; mọi câu trong danh mục đều tra ngược được', () => {
    for (const [k, v] of Object.entries(MSG)) expect(keyOfMessage(v)).toBe(k);
    expect(keyOfMessage('roomId không hợp lệ')).toBe('invalid_room_id');
    expect(keyOfMessage('Nước đi không hợp lệ: h2h9')).toBe('illegal_move');
    expect(keyOfMessage('câu lạ')).toBeNull();
  });

  it('web: lỗi có details.key được dịch, kèm tham số', async () => {
    setLang('en');
    await i18n.changeLanguage('en');
    expect(errorText({ code: 'functions/permission-denied', message: 'Lời mời đã bị thu hồi', details: { key: 'invite_revoked' } })).toBe(
      'This invite has been revoked',
    );
    expect(
      errorText({ code: 'functions/failed-precondition', message: '…', details: { key: 'already_in_room', code: 'already_in_room', roomId: 'abc123' } }),
    ).toBe('You are in room abc123. Go back to it or leave it first.');
    // Không có khóa: giữ nguyên câu gốc
    expect(errorText({ code: 'functions/internal', message: 'raw message' })).toBe('raw message');
    // Phản hồi lệnh trận: ưu tiên messageKey, sau đó mã lệnh
    expect(commandText({ code: 'not_allowed', message: 'Chưa thể cầu hòa…', messageKey: 'draw_too_early' })).toBe(
      'You cannot offer a draw before both sides have moved',
    );
    expect(commandText({ code: 'stale_version', message: null })).toBe('The board just changed – resynchronized');
    await i18n.changeLanguage('vi');
    expect(errorText({ message: 'x', details: { key: 'invite_revoked' } })).toBe('Lời mời đã bị thu hồi');
  });
});
