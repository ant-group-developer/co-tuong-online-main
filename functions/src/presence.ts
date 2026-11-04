/**
 * Đếm người xem theo UID (nhiều tab/kết nối của cùng UID chỉ tính 1), loại trừ hai người chơi.
 * Client ghi roomViewers/{roomId}/{uid}/{connectionId} và đăng ký onDisconnect().remove() TRƯỚC khi ghi.
 */
import { onValueWritten } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { DB_TRIGGER_REGION, REGION } from './config.js';
import type { RoomDoc } from './core/room-core.js';
import { rtdb } from './firebase.js';

export const onRoomViewer = onValueWritten({ ref: '/roomViewers/{roomId}/{uid}', region: DB_TRIGGER_REGION }, async (event) => {
  const { roomId } = event.params;
  const [viewersSnap, seatsSnap] = await Promise.all([
    rtdb().ref(`roomViewers/${roomId}`).get(),
    rtdb().ref(`rooms/${roomId}/seats`).get(),
  ]);
  const seats = (seatsSnap.val() ?? {}) as RoomDoc['seats'];
  const playerUids = new Set([seats?.host?.uid, seats?.guest?.uid].filter(Boolean) as string[]);
  let spectators = 0;
  const online: Record<string, boolean> = {};
  viewersSnap.forEach((c) => {
    if (playerUids.has(c.key!)) online[c.key!] = true;
    else spectators++;
  });
  await rtdb().ref(`roomStats/${roomId}`).set({ spectators, playersOnline: online, updatedAt: Date.now() });
  // Chỉ cập nhật chỉ mục lobby nếu phòng còn được liệt kê (không tạo lại mục đã gỡ).
  await rtdb()
    .ref(`publicRooms/${roomId}`)
    .transaction((cur: Record<string, unknown> | null) => {
      if (!cur) return cur;
      return { ...cur, spectators };
    });
});

/** Dọn dẹp hằng ngày: phòng đã kết thúc/hủy > 24h (kết quả đã ghi), lời mời hết hạn, chỉ mục mồ côi. */
export const dailyCleanup = onSchedule({ region: REGION, schedule: 'every day 04:00', timeZone: 'Asia/Ho_Chi_Minh' }, async () => {
  const db = rtdb();
  const cutoff = Date.now() - 24 * 3600_000;
  const rooms = await db.ref('rooms').orderByChild('meta/updatedAt').endAt(cutoff).limitToFirst(300).get();
  const updates: Record<string, null> = {};
  rooms.forEach((c) => {
    const room = c.val() as RoomDoc;
    const st = room.meta?.status;
    const pending = Object.values(room.matches ?? {}).some((m) => m.outbox && m.outbox.status !== 'done');
    if ((st === 'finished' || st === 'cancelled' || st === 'waiting' || st === 'ready') && !pending) {
      updates[`rooms/${c.key}`] = null;
      updates[`publicRooms/${c.key}`] = null;
      updates[`roomViewers/${c.key}`] = null;
      updates[`roomStats/${c.key}`] = null;
      updates[`roomLastSeen/${c.key}`] = null;
      updates[`roomInvites/${c.key}`] = null;
    }
  });
  const invites = await db.ref('invites').orderByChild('expiresAt').endAt(Date.now()).limitToFirst(500).get();
  invites.forEach((c) => {
    updates[`invites/${c.key}`] = null;
  });
  if (Object.keys(updates).length) await db.ref().update(updates);
});
