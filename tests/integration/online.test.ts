/**
 * Integration với Emulator Suite (Auth + RTDB + Firestore + Functions + Tasks):
 * tạo/vào phòng, tranh ghế, ready/start, đi quân, idempotency, người xem, phòng riêng tư + lời mời,
 * ranked matchmaking, kết quả -> Firestore đúng một lần.
 * Chạy: npm run test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, createUserWithEmailAndPassword } from 'firebase/auth';
import { connectDatabaseEmulator, get, getDatabase, ref, set, serverTimestamp } from 'firebase/database';
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-xiangqi';
const apps: FirebaseApp[] = [];
let seq = 0;

interface Client {
  uid: string;
  call: <T = any>(name: string, data: unknown) => Promise<T>;
  read: <T = any>(path: string) => Promise<T | null>;
  write: (path: string, v: unknown) => Promise<void>;
  fsGet: (path: string) => Promise<any>;
}

async function client(kind: 'anon' | 'email' = 'email'): Promise<Client> {
  const app = initializeApp(
    { apiKey: 'demo', projectId: PROJECT, databaseURL: `https://${PROJECT}-default-rtdb.firebaseio.com` },
    `c${++seq}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
  const fs = getFirestore(app);
  connectFirestoreEmulator(fs, '127.0.0.1', 8085);
  const fns = getFunctions(app, 'asia-southeast1');
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  const cred =
    kind === 'anon'
      ? await signInAnonymously(auth)
      : await createUserWithEmailAndPassword(auth, `u${Date.now()}_${seq}@test.local`, 'secret123');
  return {
    uid: cred.user.uid,
    call: async (name, data) => (await httpsCallable(fns, name)(data)).data as any,
    read: async (path) => (await get(ref(db, path))).val(),
    write: (path, v) => set(ref(db, path), v),
    fsGet: async (path) => {
      const s = await getDoc(doc(fs, path));
      return s.exists() ? s.data() : null;
    },
  };
}

const cid = () => `it_${Math.random().toString(36).slice(2, 12)}`;

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 20_000, step = 300): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, step));
  }
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code: `functions/${code}` });
}

/** Tạo phòng bạn bè public, khách vào, hai bên sẵn sàng => trả về {roomId, matchId, red, black}. */
async function startFriendly(host: Client, guest: Client, extra: Record<string, unknown> = {}) {
  const { roomId } = await host.call('createRoom', { visibility: 'public', tc: '10+5', ownerColor: 'red', ...extra });
  await guest.call('joinRoom', { roomId, as: 'player' });
  await host.call('setReady', { roomId, ready: true });
  const r = await guest.call('setReady', { roomId, ready: true });
  const matchId = r.startedMatchId as string;
  const players = await host.read(`rooms/${roomId}/matches/${matchId}/players`);
  const red = players.red.uid === host.uid ? host : guest;
  const black = red === host ? guest : host;
  return { roomId, matchId, red, black };
}

beforeAll(async () => {
  // Chờ Functions emulator sẵn sàng
  await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:5001/${PROJECT}/asia-southeast1/createRoom`, { method: 'OPTIONS' });
      return r.status < 500;
    } catch {
      return false;
    }
  }, 60_000);
});

afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a)));
});

describe('phòng bạn bè', () => {
  it('tạo phòng, khách vào, sẵn sàng => trận bắt đầu, chủ phòng cầm Đỏ', async () => {
    const host = await client();
    const guest = await client('anon');
    const { roomId, matchId, red } = await startFriendly(host, guest);
    expect(red.uid).toBe(host.uid);
    const meta = await host.read(`rooms/${roomId}/meta`);
    expect(meta).toMatchObject({ status: 'playing', mode: 'friendly', matchId });
    const pub = await waitFor(() => guest.read(`publicRooms/${roomId}`));
    expect(pub).toMatchObject({ status: 'playing' });
    expect(JSON.stringify(pub)).not.toMatch(/members|token|email/);
  });

  it('hai người tranh một ghế cùng lúc: chỉ một người được ghế', async () => {
    const host = await client();
    const a = await client();
    const b = await client();
    const { roomId } = await host.call('createRoom', { visibility: 'public', tc: '5+0' });
    const results = await Promise.allSettled([a.call('joinRoom', { roomId, as: 'player' }), b.call('joinRoom', { roomId, as: 'player' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const seats = await host.read(`rooms/${roomId}/seats`);
    expect([a.uid, b.uid]).toContain(seats.guest.uid);
  });

  it('đi quân: xác thực server, idempotent khi gửi lại, từ chối version cũ/sai lượt/nước sai', async () => {
    const host = await client();
    const guest = await client();
    const { roomId, matchId, red, black } = await startFriendly(host, guest);
    const cmd = { roomId, matchId, commandId: cid(), expectedVersion: 1, from: 'h2', to: 'e2' };
    const [r1, r2] = await Promise.all([red.call('submitMove', cmd), red.call('submitMove', cmd)]);
    expect([r1.code, r2.code].sort()).toEqual(['duplicate', 'ok']);
    const st = await red.read(`rooms/${roomId}/matches/${matchId}/state`);
    expect(st).toMatchObject({ v: 2, moves: 'h2e2', turn: 'black' });
    expect((await black.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 1, from: 'h9', to: 'g7' })).code).toBe('stale_version');
    expect((await red.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 2, from: 'h0', to: 'g2' })).code).toBe('not_your_turn');
    expect((await black.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 2, from: 'h9', to: 'h5' })).code).toBe('illegal_move');
    // Người ngoài không gửi lệnh được
    const stranger = await client();
    await expectCode(stranger.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 2, from: 'h9', to: 'g7' }), 'permission-denied');
  });

  it('hai tab cùng UID gửi hai nước cùng version: đúng một nước được nhận', async () => {
    const host = await client();
    const guest = await client();
    const { roomId, matchId, red } = await startFriendly(host, guest);
    const [a, b] = await Promise.all([
      red.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 1, from: 'h2', to: 'e2' }),
      red.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 1, from: 'b2', to: 'e2' }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const st = await red.read(`rooms/${roomId}/matches/${matchId}/state`);
    expect(st.v).toBe(2);
  });

  it('đầu hàng + đi quân đồng thời: kết quả chỉ ghi một lần, Firestore cập nhật đúng một lần (không tính rating)', async () => {
    const host = await client();
    const guest = await client();
    const { roomId, matchId, red, black } = await startFriendly(host, guest);
    await red.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 1, from: 'h2', to: 'e2' });
    await Promise.allSettled([
      black.call('matchAction', { roomId, matchId, commandId: cid(), expectedVersion: 2, type: 'resign' }),
      black.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 2, from: 'h9', to: 'g7' }),
      red.call('matchAction', { roomId, matchId, commandId: cid(), expectedVersion: 2, type: 'resign' }),
    ]);
    const st = await red.read(`rooms/${roomId}/matches/${matchId}/state`);
    expect(st.status).toBe('finished');
    expect(st.result.reason).toBe('resign');
    // Trigger outbox -> Firestore
    const archived = await waitFor(() => red.fsGet(`matches/${matchId}`), 30_000);
    expect(archived).toMatchObject({ rated: false, reason: 'resign' });
    const stats = await waitFor(() => red.fsGet(`playerStats/${red.uid}`));
    expect(stats).toMatchObject({ rating: 1200, ratedGames: 0, friendlyGames: 1 });
    await waitFor(async () => (await red.read(`rooms/${roomId}/matches/${matchId}/outbox/status`)) === 'done');
    const meta = await red.read(`rooms/${roomId}/meta`);
    expect(meta.status).toBe('finished');
    // Không thể đi tiếp sau khi kết thúc
    expect((await red.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: st.v, from: 'h0', to: 'g2' })).code).toBe('game_over');
  });

  it('đấu lại tạo matchId mới, không ghi đè trận cũ', async () => {
    const host = await client();
    const guest = await client();
    const { roomId, matchId, red } = await startFriendly(host, guest);
    await red.call('matchAction', { roomId, matchId, commandId: cid(), expectedVersion: 1, type: 'resign' });
    await waitFor(async () => (await host.read(`rooms/${roomId}/meta/status`)) === 'finished');
    await host.call('requestRematch', { roomId });
    const r = await guest.call('requestRematch', { roomId });
    expect(r.startedMatchId).toBeTruthy();
    expect(r.startedMatchId).not.toBe(matchId);
    const old = await host.read(`rooms/${roomId}/matches/${matchId}/state/status`);
    expect(old).toBe('finished');
  });

  it('chủ phòng không thể đá khách / đổi cài đặt sau khi trận bắt đầu', async () => {
    const host = await client();
    const guest = await client();
    const { roomId } = await startFriendly(host, guest);
    await expectCode(host.call('kickGuest', { roomId }), 'failed-precondition');
    await expectCode(host.call('updateRoomSettings', { roomId, tc: '5+0' }), 'failed-precondition');
  });
});

describe('phòng riêng tư & người xem', () => {
  it('người lạ không đọc được; lời mời xem không cho vào ghế; lời mời chơi thì được; thu hồi có hiệu lực', async () => {
    const host = await client();
    const stranger = await client();
    const viewer = await client('anon');
    const player = await client();
    const { roomId } = await host.call('createRoom', { visibility: 'private', tc: '10+5' });
    expect(await host.read(`publicRooms/${roomId}`)).toBeNull();
    await expect(stranger.read(`rooms/${roomId}`)).rejects.toThrow(/permission/i);
    await expectCode(stranger.call('joinRoom', { roomId, as: 'player' }), 'permission-denied');
    await expectCode(stranger.call('joinRoom', { roomId, as: 'spectator' }), 'permission-denied');

    const viewInv = await host.call('createInvite', { roomId, role: 'spectator' });
    expect(viewInv.token.length).toBeGreaterThanOrEqual(40);
    const r1 = await viewer.call('redeemInvite', { token: viewInv.token });
    expect(r1).toMatchObject({ roomId, role: 'spectator' });
    expect(await viewer.read(`rooms/${roomId}/meta/status`)).toBe('waiting');
    await expectCode(viewer.call('joinRoom', { roomId, as: 'player' }), 'permission-denied');

    // Thu hồi
    const revoked = await host.call('createInvite', { roomId, role: 'player' });
    await host.call('revokeInvite', { roomId, inviteId: revoked.inviteId });
    await expectCode(stranger.call('redeemInvite', { token: revoked.token }), 'permission-denied');

    const playInv = await host.call('createInvite', { roomId, role: 'player' });
    await player.call('redeemInvite', { token: playInv.token });
    await player.call('joinRoom', { roomId, as: 'player' });
    expect((await host.read(`rooms/${roomId}/seats/guest`)).uid).toBe(player.uid);
    // Token sai/không tồn tại
    await expectCode(stranger.call('redeemInvite', { token: 'x'.repeat(43) }), 'permission-denied');
    // Người không phải chủ phòng không tạo/thu hồi lời mời
    await expectCode(player.call('createInvite', { roomId, role: 'player' }), 'permission-denied');
  });

  it('đếm người xem theo UID (nhiều kết nối = 1), không tính người chơi', async () => {
    const host = await client();
    const guest = await client();
    const { roomId } = await startFriendly(host, guest);
    const spec = await client('anon');
    await spec.write(`roomViewers/${roomId}/${spec.uid}/connA`, { at: serverTimestamp() });
    await spec.write(`roomViewers/${roomId}/${spec.uid}/connB`, { at: serverTimestamp() });
    await host.write(`roomViewers/${roomId}/${host.uid}/c1`, { at: serverTimestamp() });
    const stats = await waitFor(async () => {
      const s = await spec.read(`roomStats/${roomId}`);
      return s && s.playersOnline?.[host.uid] && s.spectators === 1 ? s : null;
    }, 30_000);
    expect(stats.spectators).toBe(1);
    // Người xem không gửi được lệnh đi quân
    const matchId = await host.read(`rooms/${roomId}/meta/matchId`);
    await expectCode(spec.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 1, from: 'h2', to: 'e2' }), 'permission-denied');
  });
});

describe('giữ người chơi trong phòng (userRooms)', () => {
  const inRoom = (roomId: string) => ({ code: 'functions/failed-precondition', details: { code: 'already_in_room', roomId } });

  it('đang ngồi ở phòng thì không tạo/vào phòng khác hay tìm trận xếp hạng; rời phòng hoặc trận xong thì được', async () => {
    const host = await client('anon');
    const other = await client('anon');
    const { roomId } = await host.call('createRoom', { visibility: 'public', tc: '10+5' });
    // Chỉ mục cho chính người đó, người khác không đọc được
    expect(await waitFor(() => host.read(`userRooms/${host.uid}`))).toMatchObject({ roomId, mode: 'friendly' });
    await expect(other.read(`userRooms/${host.uid}`)).rejects.toThrow(/permission/i);

    await expect(host.call('createRoom', { visibility: 'public', tc: '10+5' })).rejects.toMatchObject(inRoom(roomId));
    const { roomId: otherRoom } = await other.call('createRoom', { visibility: 'public', tc: '10+5' });
    await expect(host.call('joinRoom', { roomId: otherRoom, as: 'player' })).rejects.toMatchObject(inRoom(roomId));
    await expect(host.call('mmEnqueue', { tc: '5+0' })).rejects.toMatchObject(inRoom(roomId));
    // Vẫn được XEM phòng khác
    expect((await host.call('joinRoom', { roomId: otherRoom, as: 'spectator' })).role).toBe('spectator');

    // Rời phòng => chỉ mục bị xóa, tạo phòng mới được
    await host.call('leaveRoom', { roomId });
    expect(await host.read(`userRooms/${host.uid}`)).toBeNull();
    const { roomId: second } = await host.call('createRoom', { visibility: 'private', tc: '5+0' });
    expect((await host.read(`userRooms/${host.uid}`)).roomId).toBe(second);
    await host.call('leaveRoom', { roomId: second });
    await other.call('leaveRoom', { roomId: otherRoom });

    // Trận kết thúc => cả hai không còn "đang ở phòng"
    const a = await client('anon');
    const b = await client('anon');
    const { roomId: r3, matchId, red } = await startFriendly(a, b);
    expect((await b.read(`userRooms/${b.uid}`)).roomId).toBe(r3);
    await red.call('matchAction', { roomId: r3, matchId, commandId: cid(), expectedVersion: 1, type: 'resign' });
    await waitFor(async () => (await a.read(`userRooms/${a.uid}`)) === null && (await b.read(`userRooms/${b.uid}`)) === null);
  });

  it('khách rời ghế: chỉ mục của khách bị xóa, của chủ phòng vẫn giữ', async () => {
    const host = await client('anon');
    const guest = await client('anon');
    const { roomId } = await host.call('createRoom', { visibility: 'public', tc: '10+5' });
    await guest.call('joinRoom', { roomId, as: 'player' });
    expect((await guest.read(`userRooms/${guest.uid}`)).roomId).toBe(roomId);
    await guest.call('leaveRoom', { roomId });
    expect(await guest.read(`userRooms/${guest.uid}`)).toBeNull();
    expect((await host.read(`userRooms/${host.uid}`)).roomId).toBe(roomId);
    await host.call('leaveRoom', { roomId });
  });
});

describe('đấu xếp hạng', () => {
  it('khách (anonymous) cũng được đấu xếp hạng', async () => {
    const x = await client('anon');
    const y = await client('anon');
    expect((await x.call('mmEnqueue', { tc: '5+0' })).status).toBe('queued');
    const ry = await y.call('mmEnqueue', { tc: '5+0' });
    expect(ry.status).toBe('matched');
    const roomId = ry.roomId as string;
    const matchId = ry.matchId as string;
    await waitFor(() => x.read(`rooms/${roomId}/meta`));
    expect((await x.read(`userRooms/${x.uid}`)).roomId).toBe(roomId);
    // Kết thúc trận để không để lại người trong hàng chờ cho test sau
    await x.call('matchAction', { roomId, matchId, commandId: cid(), expectedVersion: 1, type: 'resign' });
    const stats = await waitFor(async () => {
      const s = await y.fsGet(`playerStats/${y.uid}`);
      return s && s.ratedGames === 1 ? s : null;
    }, 30_000);
    expect(stats.rating).toBe(1220);
  });

  it('ghép hai người, chống tự ghép/enqueue trùng, chơi xong cộng Elo đúng một lần, lease được gỡ', async () => {
    const a = await client();
    const b = await client();
    expect((await a.call('mmEnqueue', { tc: '10+5' })).status).toBe('queued');
    expect((await a.call('mmEnqueue', { tc: '10+5' })).status).toBe('queued'); // không tự ghép
    const rb = await b.call('mmEnqueue', { tc: '10+5' });
    expect(rb.status).toBe('matched');
    const ra = await a.call('mmEnqueue', { tc: '10+5' });
    expect(ra).toMatchObject({ status: 'matched', roomId: rb.roomId });
    // Hủy sau khi đã ghép: không mất trận
    expect((await a.call('mmCancel', {})).status).toBe('matched');
    const roomId = rb.roomId as string;
    const matchId = rb.matchId as string;
    const meta = await waitFor(() => a.read(`rooms/${roomId}/meta`));
    expect(meta).toMatchObject({ mode: 'ranked', status: 'playing', visibility: 'public' });
    const players = await a.read(`rooms/${roomId}/matches/${matchId}/players`);
    const red = players.red.uid === a.uid ? a : b;
    const black = red === a ? b : a;
    // Không vào ghế phòng ranked bằng link
    const c = await client();
    await expectCode(c.call('joinRoom', { roomId, as: 'player' }), 'failed-precondition');
    // Không được xin đi lại trong ranked
    await red.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 1, from: 'h2', to: 'e2' });
    await black.call('submitMove', { roomId, matchId, commandId: cid(), expectedVersion: 2, from: 'h9', to: 'g7' });
    expect((await red.call('matchAction', { roomId, matchId, commandId: cid(), expectedVersion: 3, type: 'requestUndo' })).code).toBe('not_allowed');
    // Đang có trận rated: vào hàng chờ lại trả về trận hiện tại
    expect((await a.call('mmEnqueue', { tc: '5+0' })).status).toBe('matched');
    await black.call('matchAction', { roomId, matchId, commandId: cid(), expectedVersion: 3, type: 'resign' });

    const ledgerApplied = await waitFor(async () => {
      const s = await red.fsGet(`playerStats/${red.uid}`);
      return s && s.ratedGames === 1 ? s : null;
    }, 30_000);
    expect(ledgerApplied.rating).toBe(1220); // K=40 tạm thời, thắng đối thủ ngang điểm
    const blackStats = await black.fsGet(`playerStats/${black.uid}`);
    expect(blackStats).toMatchObject({ rating: 1180, ratedGames: 1, losses: 1 });
    const hist = await red.fsGet(`players/${red.uid}/history/${matchId}`);
    expect(hist).toMatchObject({ result: 'win', rated: true, ratingBefore: 1200, ratingAfter: 1220 });
    // Chưa đủ 5 trận => chưa có trên leaderboard
    expect(await red.fsGet(`leaderboard/${red.uid}`)).toBeNull();
    // Lease được gỡ => vào hàng chờ mới được
    await waitFor(async () => (await a.call('mmEnqueue', { tc: '5+0' })).status === 'queued', 20_000, 1000);
    await a.call('mmCancel', {});
  });
});
