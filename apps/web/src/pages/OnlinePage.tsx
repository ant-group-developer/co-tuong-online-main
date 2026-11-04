/**
 * Sảnh online: danh sách phòng công khai (phân trang), tạo phòng chơi với bạn, vào bằng mã phòng/mã mời.
 */
import { endBefore, get, limitToLast, onValue, orderByChild, query, ref } from 'firebase/database';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, NotConfigured, Spinner, Toast } from '../components/common';
import { alreadyInRoomOf, api, errorVi, TC_OPTIONS, type Tc } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fb } from '../lib/firebase';
import { ROOM_STATUS_VI, useMyActiveRoom } from '../lib/myroom';
import type { PublicRoom } from '../lib/types';

const PAGE = 15;

export function OnlinePage() {
  const auth = useAuth();
  const nav = useNavigate();
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [older, setOlder] = useState<PublicRoom[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [tc, setTc] = useState<Tc>('10+5');
  const [color, setColor] = useState<'red' | 'black' | 'random'>('random');
  const [code, setCode] = useState('');
  const myRoom = useMyActiveRoom();

  useEffect(() => {
    if (!auth.configured || !auth.ready) return;
    let unsub: (() => void) | undefined;
    auth
      .ensureSignedIn()
      .then(() => {
        // Trang đầu realtime: các phòng cập nhật gần nhất.
        const q = query(ref(fb().db, 'publicRooms'), orderByChild('updatedAt'), limitToLast(PAGE));
        unsub = onValue(
          q,
          (snap) => {
            const list: PublicRoom[] = [];
            snap.forEach((c) => {
              list.push(c.val() as PublicRoom);
            });
            list.reverse();
            setRooms(list);
            setHasMore(list.length === PAGE);
          },
          (e) => setError(errorVi(e)),
        );
      })
      .catch((e) => setError(errorVi(e)));
    return () => unsub?.();
  }, [auth.configured, auth.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    const all = [...(rooms ?? []), ...older];
    const last = all[all.length - 1];
    if (!last) return;
    const snap = await get(query(ref(fb().db, 'publicRooms'), orderByChild('updatedAt'), endBefore(last.updatedAt, last.roomId), limitToLast(PAGE)));
    const list: PublicRoom[] = [];
    snap.forEach((c) => {
      list.push(c.val() as PublicRoom);
    });
    list.reverse();
    setOlder((o) => [...o, ...list.filter((r) => !all.some((x) => x.roomId === r.roomId))]);
    setHasMore(list.length === PAGE);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await auth.ensureSignedIn();
      const r = await api.createRoom({ visibility, tc, ownerColor: color });
      nav(`/room/${r.roomId}`);
    } catch (err) {
      const other = alreadyInRoomOf(err);
      if (other) nav(`/room/${other}`);
      else setToast(errorVi(err));
    } finally {
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const v = code.trim();
    if (!v) return;
    // Chấp nhận: link /join/<token>, link /room/<id>, mã phòng, hoặc mã mời.
    const mJoin = v.match(/\/join\/([A-Za-z0-9_-]{20,})/);
    const mRoom = v.match(/\/room\/([a-z0-9]{6,24})/);
    if (mJoin) nav(`/join/${mJoin[1]}`);
    else if (mRoom) nav(`/room/${mRoom[1]}`);
    else if (/^[a-z0-9]{6,24}$/.test(v)) nav(`/room/${v}`);
    else if (/^[A-Za-z0-9_-]{20,100}$/.test(v)) nav(`/join/${v}`);
    else setToast('Mã không hợp lệ');
  };

  if (!auth.configured) return <NotConfigured />;
  const all = [...(rooms ?? []), ...older];

  return (
    <div className="page">
      <Toast message={toast} onClose={() => setToast(null)} />
      <h1>Phòng & xem trận</h1>
      {myRoom && (
        <div className="card highlight my-room" data-testid="my-room">
          <div className="stack-tight">
            <strong>
              Bạn đang ở {myRoom.mode === 'ranked' ? 'trận xếp hạng' : 'phòng'} {myRoom.roomId}
            </strong>
            <span className="muted small">{ROOM_STATUS_VI[myRoom.status]}. Rời phòng đó trước khi tạo hoặc vào phòng khác.</span>
          </div>
          <div className="row">
            <Link className="btn primary" to={`/room/${myRoom.roomId}`} data-testid="my-room-back">
              Quay lại phòng
            </Link>
          </div>
        </div>
      )}
      <div className="two-col">
        <section className="stack">
          <div className="row between">
            <h2 className="h3">Phòng công khai</h2>
            <Link to="/ranked" className="btn small">
              Đấu xếp hạng →
            </Link>
          </div>
          {error ? (
            <ErrorState message={error} />
          ) : rooms === null ? (
            <Spinner label="Đang tải danh sách phòng…" />
          ) : all.length === 0 ? (
            <EmptyState title="Chưa có phòng nào" message="Hãy tạo phòng mới và mời bạn bè." />
          ) : (
            <ul className="room-list" data-testid="room-list">
              {all.map((r) => {
                const playing = r.status === 'playing';
                return (
                  <li key={r.roomId} className="room-item card">
                    <div>
                      <strong>{playing && r.redName ? `${r.redName} vs ${r.blackName}` : r.hostName ?? r.ownerName}</strong>
                      <small className="muted">
                        {r.mode === 'ranked' ? 'Xếp hạng' : 'Giao hữu'} · {r.tcLabel} ·{' '}
                        {playing ? 'Đang đấu' : r.seatsFree ? 'Chờ đối thủ (1 ghế trống)' : 'Đủ người'} · 👁 {r.spectators ?? 0}
                      </small>
                    </div>
                    <div className="row">
                      {r.status === 'waiting' && r.seatsFree > 0 && r.mode === 'friendly' && (
                        <Link className="btn primary small" to={`/room/${r.roomId}`}>
                          Vào chơi
                        </Link>
                      )}
                      <Link className="btn small" to={`/room/${r.roomId}`}>
                        Xem
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {hasMore && (
            <button type="button" className="btn" onClick={() => void loadMore().catch((e) => setToast(errorVi(e)))}>
              Tải thêm
            </button>
          )}
        </section>
        <section className="stack">
          <form className="card stack" onSubmit={create} aria-label="Tạo phòng chơi với bạn">
            <h2 className="h3">Chơi với bạn – tạo phòng</h2>
            <p className="muted small">Không tính điểm xếp hạng. Đấu xếp hạng do hệ thống ghép đối thủ.</p>
            <div className="form-grid">
              <label>
                Hiển thị
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'public' | 'private')} data-testid="create-visibility">
                  <option value="public">Công khai</option>
                  <option value="private">Riêng tư</option>
                </select>
              </label>
              <label>
                Thời gian
                <select value={tc} onChange={(e) => setTc(e.target.value as Tc)}>
                  {TC_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bạn cầm
                <select value={color} onChange={(e) => setColor(e.target.value as 'red' | 'black' | 'random')} data-testid="create-color">
                  <option value="random">Ngẫu nhiên</option>
                  <option value="red">Đỏ</option>
                  <option value="black">Đen</option>
                </select>
              </label>
            </div>
            <div className="row">
              <button type="submit" className="btn primary" disabled={busy || !!myRoom} data-testid="create-room">
                Tạo phòng
              </button>
              {myRoom && <span className="muted small">Bạn đang ở phòng {myRoom.roomId}</span>}
            </div>
          </form>
          <form className="card stack" onSubmit={join} aria-label="Vào phòng bằng mã">
            <h2 className="h3">Có mã phòng / mã mời?</h2>
            <div className="copy-row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Dán link hoặc mã" aria-label="Link hoặc mã" />
              <button type="submit" className="btn">
                Vào
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
