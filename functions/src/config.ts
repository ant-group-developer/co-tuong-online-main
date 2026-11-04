/**
 * Cấu hình server. Các giá trị liên quan rating có VERSION để có thể đổi về sau mà vẫn truy vết được.
 */
export const REGION = 'asia-southeast1'; // Singapore: gần Việt Nam, trùng vùng RTDB/Firestore khuyến nghị

/**
 * Vùng của trigger RTDB PHẢI trùng vùng của instance Realtime Database.
 * - Production: mặc định asia-southeast1 (tạo RTDB ở Singapore). Nếu instance ở vùng khác, đặt RTDB_REGION trong functions/.env.
 * - Emulator: Functions emulator chỉ kích hoạt trigger RTDB v2 ở us-central1.
 */
export const DB_TRIGGER_REGION =
  process.env.FUNCTIONS_EMULATOR === 'true' ? 'us-central1' : process.env.RTDB_REGION || REGION;

export const TIME_CONTROLS: Record<string, { initialMs: number; incrementMs: number; label: string }> = {
  '5+0': { initialMs: 5 * 60_000, incrementMs: 0, label: '5 phút' },
  '10+5': { initialMs: 10 * 60_000, incrementMs: 5_000, label: '10 phút + 5 giây' },
  '15+10': { initialMs: 15 * 60_000, incrementMs: 10_000, label: '15 phút + 10 giây' },
};
export const RANKED_TIME_CONTROLS = ['5+0', '10+5'];

export const MATCH_POLICY = {
  /** Thời gian tối đa để đi nước đầu tiên của mỗi bên; quá hạn => trận bị hủy (không tính). */
  firstMoveMs: 30_000,
  /** Ân hạn mạng cố định khi so deadline (server là nguồn thời gian duy nhất). */
  moveGraceMs: 250,
  /** Đối thủ được xử thắng nếu người kia mất kết nối liên tục quá lâu. */
  abandonAfterMs: 60_000,
  /** Số lệnh đã xử lý giữ lại để chống gửi lặp (idempotency). */
  keepCommands: 40,
};

export const RATING_CONFIG = {
  version: 'elo-v1',
  initial: 1200,
  /** K = kProvisional cho tới khi đủ provisionalGames trận rated, sau đó kStable. */
  kProvisional: 40,
  kStable: 32,
  provisionalGames: 10,
  /** Số trận rated tối thiểu để xuất hiện trên bảng xếp hạng. */
  placementGames: 5,
  floor: 100,
};

export const MATCHMAKING = {
  baseWindow: 100,
  /** Mở rộng khoảng rating mỗi 5 giây chờ. */
  windowStepPer5s: 25,
  maxWindow: 600,
  /** Mục trong hàng chờ bị coi là bỏ đi nếu client không poll trong khoảng này. */
  staleMs: 20_000,
};

export const LIMITS = {
  maxMembers: 50,
  maxInvitesPerRoom: 20,
  inviteDefaultTtlMs: 24 * 3600_000,
  inviteMaxTtlMs: 7 * 24 * 3600_000,
  createRoomPer10Min: 10,
  displayNameMax: 24,
};
