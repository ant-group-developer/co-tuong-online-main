/**
 * Test Security Rules RTDB + Firestore bằng emulator (chạy qua `npm run test:rules`).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, get, set, remove, update, serverTimestamp } from 'firebase/database';
import { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp as fsTs, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

function hostPort(v: string | undefined, def: string): { host: string; port: number } {
  const [host, port] = (v ?? def).split(':');
  return { host, port: Number(port) };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-xiangqi',
    database: { ...hostPort(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9000'), rules: readFileSync('database.rules.json', 'utf8') },
    firestore: { ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085'), rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

const publicRoom = {
  meta: { roomId: 'pub001', ownerUid: 'owner', visibility: 'public', status: 'playing', mode: 'friendly' },
  seats: { host: { uid: 'owner', name: 'Chủ' }, guest: { uid: 'guest', name: 'Khách' } },
  members: { owner: { role: 'player' }, guest: { role: 'player' } },
  matches: { m1: { state: { v: 3, moves: 'h2e2' } } },
};
const privateRoom = {
  meta: { roomId: 'prv001', ownerUid: 'owner', visibility: 'private', status: 'waiting', mode: 'friendly' },
  seats: { host: { uid: 'owner', name: 'Chủ' } },
  members: { owner: { role: 'player' }, viewer: { role: 'spectator' } },
};

beforeEach(async () => {
  await env.clearDatabase();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, 'rooms/pub001'), publicRoom);
    await set(ref(db, 'rooms/prv001'), privateRoom);
    await set(ref(db, 'publicRooms/pub001'), { roomId: 'pub001', status: 'playing' });
    await set(ref(db, 'invites/hash123'), { roomId: 'prv001', role: 'player', expiresAt: Date.now() + 1e6 });
    await set(ref(db, 'roomInvites/prv001/inv1'), { role: 'player', tokenHash: 'hash123' });
    await set(ref(db, 'mm/assign/alice'), { roomId: 'r', matchId: 'm' });
    await set(ref(db, 'mm/queue/alice'), { rating: 1200 });
    const fs = ctx.firestore();
    await setDoc(doc(fs, 'publicProfiles/alice'), { displayName: 'Alice', createdAt: new Date(), updatedAt: new Date() });
    await setDoc(doc(fs, 'playerStats/alice'), { rating: 1300 });
    await setDoc(doc(fs, 'leaderboard/alice'), { rating: 1300, uid: 'alice' });
    await setDoc(doc(fs, 'matches/pubm'), { visibility: 'public', playerUids: ['alice', 'bob'] });
    await setDoc(doc(fs, 'matches/privm'), { visibility: 'private', playerUids: ['alice', 'bob'] });
    await setDoc(doc(fs, 'players/alice/history/pubm'), { visibility: 'public', endedAt: 2 });
    await setDoc(doc(fs, 'players/alice/history/privm'), { visibility: 'private', endedAt: 1 });
    await setDoc(doc(fs, 'ratingLedger/pubm'), { rated: true });
  });
});

describe('RTDB – phòng', () => {
  it('chưa đăng nhập không đọc được gì', async () => {
    const db = env.unauthenticatedContext().database();
    await assertFails(get(ref(db, 'rooms/pub001')));
    await assertFails(get(ref(db, 'publicRooms')));
  });

  it('người lạ (kể cả anonymous) đọc được phòng public, KHÔNG đọc được phòng private', async () => {
    const db = env.authenticatedContext('stranger', { firebase: { sign_in_provider: 'anonymous' } }).database();
    await assertSucceeds(get(ref(db, 'rooms/pub001')));
    await assertSucceeds(get(ref(db, 'publicRooms')));
    await assertFails(get(ref(db, 'rooms/prv001')));
    await assertFails(get(ref(db, 'rooms/prv001/meta')));
  });

  it('không ai đọc được danh sách toàn bộ rooms (không có .read ở cha)', async () => {
    await assertFails(get(ref(env.authenticatedContext('owner').database(), 'rooms')));
  });

  it('khán giả được mời đọc được phòng private', async () => {
    await assertSucceeds(get(ref(env.authenticatedContext('viewer').database(), 'rooms/prv001')));
  });

  it('không ai (kể cả người chơi/chủ phòng) ghi trực tiếp bàn cờ, kết quả, ghế, members', async () => {
    for (const uid of ['owner', 'guest', 'stranger']) {
      const db = env.authenticatedContext(uid).database();
      await assertFails(set(ref(db, 'rooms/pub001/matches/m1/state/moves'), 'h2e2 h9g7'));
      await assertFails(set(ref(db, 'rooms/pub001/matches/m1/state/result'), { winner: 'red' }));
      await assertFails(update(ref(db, 'rooms/pub001/seats/guest'), { uid }));
      await assertFails(set(ref(db, `rooms/prv001/members/${uid}`), { role: 'player' }));
      await assertFails(set(ref(db, 'publicRooms/pub001/status'), 'waiting'));
    }
  });

  it('lời mời: token hash và danh sách mời không lộ ra (trừ chủ phòng xem danh sách của mình)', async () => {
    const stranger = env.authenticatedContext('stranger').database();
    await assertFails(get(ref(stranger, 'invites')));
    await assertFails(get(ref(stranger, 'invites/hash123')));
    await assertFails(get(ref(stranger, 'roomInvites/prv001')));
    await assertFails(get(ref(env.authenticatedContext('viewer').database(), 'roomInvites/prv001')));
    await assertSucceeds(get(ref(env.authenticatedContext('owner').database(), 'roomInvites/prv001')));
    await assertFails(get(ref(env.authenticatedContext('owner').database(), 'invites/hash123')));
  });

  it('matchmaking: chỉ đọc assignment của chính mình, không đọc/ghi hàng chờ', async () => {
    const alice = env.authenticatedContext('alice').database();
    await assertSucceeds(get(ref(alice, 'mm/assign/alice')));
    await assertFails(get(ref(env.authenticatedContext('bob').database(), 'mm/assign/alice')));
    await assertFails(get(ref(alice, 'mm/queue')));
    await assertFails(set(ref(alice, 'mm/queue/alice'), { rating: 3000 }));
    await assertFails(set(ref(alice, 'mm/active/alice'), null));
  });
});

describe('RTDB – presence & người xem', () => {
  it('chỉ ghi presence của chính mình, đúng schema', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertSucceeds(set(ref(db, 'presence/alice/c1'), { at: serverTimestamp() }));
    await assertFails(set(ref(db, 'presence/bob/c1'), { at: serverTimestamp() }));
    await assertFails(set(ref(db, 'presence/alice/c2'), { at: serverTimestamp(), extra: 1 }));
    await assertSucceeds(remove(ref(db, 'presence/alice/c1')));
  });

  it('người xem chỉ đăng ký vào phòng mình được xem', async () => {
    const stranger = env.authenticatedContext('stranger').database();
    await assertSucceeds(set(ref(stranger, 'roomViewers/pub001/stranger/c1'), { at: serverTimestamp() }));
    await assertFails(set(ref(stranger, 'roomViewers/prv001/stranger/c1'), { at: serverTimestamp() }));
    await assertFails(set(ref(stranger, 'roomViewers/pub001/owner/c1'), { at: serverTimestamp() }));
    const viewer = env.authenticatedContext('viewer').database();
    await assertSucceeds(set(ref(viewer, 'roomViewers/prv001/viewer/c1'), { at: serverTimestamp() }));
    await assertFails(set(ref(stranger, 'roomStats/pub001'), { spectators: 999 }));
  });

  it('lastSeen: chỉ của mình, chỉ thời gian hợp lệ', async () => {
    const db = env.authenticatedContext('guest').database();
    await assertSucceeds(set(ref(db, 'roomLastSeen/pub001/guest'), serverTimestamp()));
    await assertFails(set(ref(db, 'roomLastSeen/pub001/owner'), serverTimestamp()));
    await assertFails(set(ref(db, 'roomLastSeen/pub001/guest'), Date.now() + 10_000_000));
  });
});

describe('Firestore', () => {
  it('hồ sơ công khai: chỉ chủ sở hữu ghi, đúng schema', async () => {
    const bob = env.authenticatedContext('bob').firestore();
    await assertSucceeds(setDoc(doc(bob, 'publicProfiles/bob'), { displayName: 'Bob', createdAt: fsTs(), updatedAt: fsTs() }));
    await assertFails(setDoc(doc(bob, 'publicProfiles/alice'), { displayName: 'Hack', createdAt: fsTs(), updatedAt: fsTs() }));
    await assertFails(setDoc(doc(bob, 'publicProfiles/bob2'), { displayName: 'Bob', createdAt: fsTs(), updatedAt: fsTs() }));
    await assertFails(updateDoc(doc(bob, 'publicProfiles/bob'), { displayName: '<b>x</b>', updatedAt: fsTs() }));
    await assertFails(updateDoc(doc(bob, 'publicProfiles/bob'), { rating: 3000, updatedAt: fsTs() }));
    await assertFails(updateDoc(doc(bob, 'publicProfiles/bob'), { displayName: 'A', updatedAt: fsTs() }));
    await assertSucceeds(getDoc(doc(bob, 'publicProfiles/alice')));
  });

  it('không client nào ghi được rating, stats, leaderboard, match, history, ledger', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(alice, 'playerStats/alice'), { rating: 3000 }));
    await assertFails(setDoc(doc(alice, 'leaderboard/alice'), { rating: 3000 }));
    await assertFails(setDoc(doc(alice, 'matches/fake'), { winner: 'red' }));
    await assertFails(setDoc(doc(alice, 'players/alice/history/fake'), { result: 'win' }));
    await assertFails(setDoc(doc(alice, 'ratingLedger/x'), {}));
    await assertFails(getDoc(doc(alice, 'ratingLedger/pubm')));
  });

  it('trận private chỉ người chơi đọc được; người lạ chỉ đọc lịch sử public', async () => {
    const bob = env.authenticatedContext('bob').firestore();
    const eve = env.authenticatedContext('eve').firestore();
    await assertSucceeds(getDoc(doc(bob, 'matches/privm')));
    await assertFails(getDoc(doc(eve, 'matches/privm')));
    await assertSucceeds(getDoc(doc(eve, 'matches/pubm')));
    await assertFails(getDocs(collection(eve, 'matches')));
    await assertSucceeds(getDocs(query(collection(eve, 'players/alice/history'), where('visibility', '==', 'public'))));
    await assertFails(getDocs(collection(eve, 'players/alice/history')));
    await assertSucceeds(getDocs(collection(env.authenticatedContext('alice').firestore(), 'players/alice/history')));
  });

  it('chưa đăng nhập không đọc leaderboard/stats', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'leaderboard/alice')));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('x').firestore(), 'leaderboard/alice')));
  });
});
