/**
 * Danh mục thông báo của server. Mỗi thông báo có một KHÓA cố định gửi kèm lỗi (`details.key`, `messageKey`)
 * để giao diện dịch sang ngôn ngữ người dùng chọn (apps/web/src/i18n). Câu tiếng Việt chỉ là bản dự phòng.
 * Thêm thông báo mới: thêm khóa ở đây + bản dịch ở `serverErrors` trong apps/web/src/i18n/{vi,en}.ts.
 */
export const MSG = {
  // Chung
  sign_in_required: 'Bạn cần đăng nhập',
  not_found: 'Không tìm thấy',
  no_permission: 'Không có quyền',
  bad_request: 'Yêu cầu không hợp lệ',
  too_fast: 'Thao tác quá nhanh, hãy thử lại sau',
  missing_field: 'Thiếu dữ liệu',
  // Phòng
  room_not_found: 'Phòng không tồn tại',
  invalid_room_id: 'Mã phòng không hợp lệ',
  invalid_visibility: 'visibility phải là public hoặc private',
  invalid_color: 'Màu không hợp lệ',
  invalid_time_control: 'Thời gian không hợp lệ',
  create_room_failed: 'Không tạo được phòng, hãy thử lại',
  private_room_need_invite: 'Phòng riêng tư: cần lời mời',
  ranked_no_seat: 'Phòng xếp hạng do hệ thống ghép, không thể vào ghế',
  room_full_or_started: 'Phòng đã đủ người hoặc đã bắt đầu',
  need_invite: 'Bạn cần lời mời hợp lệ để vào phòng riêng tư',
  invite_view_only: 'Lời mời của bạn chỉ có quyền xem',
  seat_taken: 'Ghế đã có người',
  leave_during_game: 'Trận đang diễn ra: hãy đầu hàng nếu muốn rời',
  owner_only_kick: 'Chỉ chủ phòng được mời khách ra',
  kick_after_start: 'Không thể mời khách ra sau khi trận đã bắt đầu',
  owner_only_settings: 'Chỉ chủ phòng được đổi cài đặt',
  settings_locked: 'Cài đặt đã bị khóa khi trận bắt đầu',
  not_seated: 'Bạn không ngồi ở phòng này',
  cannot_ready_now: 'Không thể đổi trạng thái sẵn sàng lúc này',
  ranked_no_rematch: 'Trận xếp hạng: hãy tìm trận mới',
  rematch_after_finish: 'Chỉ đấu lại sau khi trận kết thúc',
  missing_players: 'Thiếu người chơi',
  room_cancelled: 'Phòng đã bị hủy',
  room_full: 'Phòng đã đủ thành viên',
  already_in_room: 'Bạn đang ở một phòng khác. Hãy quay lại hoặc rời phòng đó trước.',
  // Lời mời
  owner_only_invite: 'Chỉ chủ phòng được tạo lời mời',
  ranked_no_invite: 'Phòng xếp hạng không dùng lời mời',
  invite_limit: 'Đã đạt giới hạn số lời mời của phòng',
  owner_only_revoke: 'Chỉ chủ phòng được thu hồi lời mời',
  invite_not_found: 'Lời mời không tồn tại',
  invite_invalid: 'Lời mời không hợp lệ',
  invite_revoked: 'Lời mời đã bị thu hồi',
  invite_expired: 'Lời mời đã hết hạn',
  // Trận
  match_not_found: 'Trận không tồn tại',
  invalid_match_id: 'matchId không hợp lệ',
  invalid_move_command: 'Lệnh đi quân không hợp lệ',
  invalid_command: 'Lệnh không hợp lệ',
  command_id_reused: 'commandId đã được dùng',
  not_player_of_match: 'Bạn không phải người chơi của trận này',
  match_over: 'Trận đã kết thúc',
  time_up: 'Đã hết giờ',
  stale_state: 'Trạng thái đã thay đổi, cần đồng bộ lại',
  not_your_turn: 'Chưa đến lượt bạn',
  match_data_error: 'Dữ liệu trận lỗi',
  illegal_move: 'Nước đi không hợp lệ',
  draw_too_early: 'Chưa thể cầu hòa trước khi hai bên đi nước đầu',
  no_draw_offer: 'Không có lời cầu hòa đang chờ',
  undo_not_in_ranked: 'Không được xin đi lại trong trận xếp hạng',
  no_move_to_undo: 'Chưa có nước để đi lại',
  undo_pending: 'Đang có yêu cầu đi lại',
  no_undo_request: 'Không có yêu cầu đi lại',
  opponent_has_time: 'Đối thủ vẫn còn thời gian',
  opponent_not_away_long: 'Đối thủ chưa mất kết nối đủ lâu',
  // Xếp hạng
  invalid_ranked_tc: 'Thời gian không hợp lệ cho đấu xếp hạng',
  queue_error: 'Lỗi hàng chờ',
} as const;

export type MsgKey = keyof typeof MSG;

const KEY_BY_TEXT = new Map<string, MsgKey>(Object.entries(MSG).map(([k, v]) => [v, k as MsgKey]));
// Câu khác chữ nhưng cùng nghĩa
KEY_BY_TEXT.set('roomId không hợp lệ', 'invalid_room_id');

/** Khóa của một thông báo (null nếu là câu động/không có trong danh mục). */
export function keyOfMessage(text: string | null | undefined): MsgKey | null {
  if (!text) return null;
  if (KEY_BY_TEXT.has(text)) return KEY_BY_TEXT.get(text)!;
  if (text.startsWith('Nước đi không hợp lệ')) return 'illegal_move';
  return null;
}
