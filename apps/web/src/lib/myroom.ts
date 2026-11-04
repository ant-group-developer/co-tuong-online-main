/**
 * Phòng mà người dùng hiện tại đang ngồi ghế (server ghi chỉ mục `userRooms/{uid}`).
 * Dùng để đưa người chơi quay lại phòng sau khi chuyển trang, và chặn tạo/vào phòng khác ở giao diện.
 */
import { useAuth } from './auth';
import { useRtdb } from './rtdb';

export interface MyRoom {
  roomId: string;
  mode: 'friendly' | 'ranked';
  status: 'waiting' | 'ready' | 'playing';
}

const ACTIVE = ['waiting', 'ready', 'playing'];

export function useMyActiveRoom(): MyRoom | null {
  const auth = useAuth();
  const uid = auth.configured && auth.ready ? (auth.user?.uid ?? null) : null;
  const entry = useRtdb<{ roomId: string; mode: MyRoom['mode'] }>(uid ? `userRooms/${uid}` : null);
  const roomId = entry.data?.roomId ?? null;
  // Kiểm tra lại trạng thái thật của phòng (chỉ mục có thể cũ nếu phòng đã bị dọn).
  const status = useRtdb<string>(roomId ? `rooms/${roomId}/meta/status` : null);
  if (!roomId || !status.data || !ACTIVE.includes(status.data)) return null;
  return { roomId, mode: entry.data!.mode, status: status.data as MyRoom['status'] };
}
