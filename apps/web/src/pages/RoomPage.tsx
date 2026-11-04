/**
 * Phòng online: phòng chờ (mời bạn, sẵn sàng), bàn đấu cho người chơi, chế độ xem cho khán giả.
 * Nước đi gửi lên server dạng intent (commandId + expectedVersion); chỉ coi là chấp nhận khi RTDB có version mới.
 */
import { END_REASON_VI, iccsToSquare, replayMoves, squareToIccs, type Game, type Side } from '@xq/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Board } from '../components/Board';
import { ErrorState, Modal, NotConfigured, SoundControl, Spinner, Toast, useNow } from '../components/common';
import { MoveList, PlayerBar, ResultBanner } from '../components/GamePanels';
import { api, errorVi, newCommandId, tcLabel, TC_OPTIONS } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConnection, useRoomPresence, useRtdb } from '../lib/rtdb';
import { playSound } from '../lib/sound';
import type { MatchPlayers, MatchState, RoomMeta, RoomStats, Seats } from '../lib/types';

const CODE_VI: Record<string, string> = {
  stale_version: 'Bàn cờ vừa thay đổi – đã đồng bộ lại',
  not_your_turn: 'Chưa đến lượt bạn',
  illegal_move: 'Nước đi không hợp lệ',
  game_over: 'Trận đã kết thúc',
  timeout: 'Đã hết giờ',
  no_offer: 'Lời đề nghị không còn hiệu lực',
  not_allowed: 'Không thể thực hiện lúc này',
  not_expired: 'Chưa thể xử lý (đối thủ vẫn còn thời gian/kết nối)',
};

export function RoomPage() {
  const { roomId = '' } = useParams();
  const auth = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.configured && auth.ready && !auth.user) auth.ensureSignedIn().catch((e) => setSignInError(errorVi(e)));
  }, [auth]);

  if (!auth.configured) return <NotConfigured />;
  if (signInError) return <ErrorState title="Không đăng nhập được" message={signInError} />;
  if (!auth.ready || !auth.user) return <Spinner label="Đang kết nối…" />;
  return <RoomInner roomId={roomId} uid={auth.user.uid} />;
}

function RoomInner({ roomId, uid }: { roomId: string; uid: string }) {
  const meta = useRtdb<RoomMeta>(`rooms/${roomId}/meta`);
  const seats = useRtdb<Seats>(`rooms/${roomId}/seats`);
  const myMember = useRtdb<{ role: string }>(`rooms/${roomId}/members/${uid}`);
  const stats = useRtdb<RoomStats>(`roomStats/${roomId}`);
  const { connected } = useConnection();
  const canView = !!meta.data && !meta.error;
  useRoomPresence(roomId, uid, canView);

  if (meta.loading) return <Spinner label="Đang tải phòng…" />;
  if (meta.error === 'permission_denied')
    return (
      <ErrorState
        title="Phòng riêng tư"
        message="Bạn cần link/mã mời hợp lệ do chủ phòng gửi để xem hoặc tham gia phòng này."
        action={
          <Link className="btn" to="/online">
            Về sảnh
          </Link>
        }
      />
    );
  if (meta.error) return <ErrorState message={meta.error} />;
  if (!meta.data)
    return (
      <ErrorState
        title="Không tìm thấy phòng"
        message="Phòng không tồn tại hoặc đã bị xóa."
        action={
          <Link className="btn" to="/online">
            Về sảnh
          </Link>
        }
      />
    );

  const m = meta.data;
  return (
    <>
      {!connected && <div className="banner warn" role="status">Mất kết nối – đang kết nối lại… Đồng hồ trên máy chủ vẫn chạy.</div>}
      {m.matchId ? (
        <MatchView roomId={roomId} matchId={m.matchId} meta={m} seats={seats.data ?? {}} uid={uid} stats={stats.data} />
      ) : m.status === 'cancelled' ? (
        <ErrorState
          title="Phòng đã bị hủy"
          action={
            <Link className="btn" to="/online">
              Về sảnh
            </Link>
          }
        />
      ) : (
        <WaitingRoom roomId={roomId} meta={m} seats={seats.data ?? {}} uid={uid} memberRole={myMember.data?.role ?? null} stats={stats.data} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Phòng chờ
// ---------------------------------------------------------------------------------------------

function WaitingRoom({
  roomId,
  meta,
  seats,
  uid,
  memberRole,
  stats,
}: {
  roomId: string;
  meta: RoomMeta;
  seats: Seats;
  uid: string;
  memberRole: string | null;
  stats: RoomStats | null;
}) {
  const nav = useNavigate();
  const isOwner = meta.ownerUid === uid;
  const mySeat = seats.host?.uid === uid ? 'host' : seats.guest?.uid === uid ? 'guest' : null;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ role: string; link: string; token: string } | null>(null);
  const invites = useRtdb<Record<string, { role: string; expiresAt: number; revoked: boolean }>>(isOwner ? `roomInvites/${roomId}` : null);
  const roomLink = `${window.location.origin}/room/${roomId}`;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setToast(errorVi(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast('Đã sao chép');
    } catch {
      setToast('Không sao chép được – hãy chọn và sao chép thủ công');
    }
  };

  const canClaim = !mySeat && !seats.guest && meta.status === 'waiting' && meta.mode === 'friendly' && (meta.visibility === 'public' || memberRole === 'player');
  const statusText = meta.status === 'waiting' ? 'Đang chờ đối thủ' : meta.status === 'ready' ? 'Đủ người – chờ hai bên sẵn sàng' : meta.status;

  return (
    <div className="page narrow">
      <Toast message={toast} onClose={() => setToast(null)} />
      <h1>Phòng {roomId}</h1>
      <p className="muted">
        {meta.visibility === 'public' ? 'Công khai' : 'Riêng tư'} · {tcLabel(meta.tc)} · Chơi với bạn (không tính điểm) ·{' '}
        <span data-testid="room-status">{statusText}</span> · {stats?.spectators ?? 0} người xem
      </p>

      <div className="seats">
        {(['host', 'guest'] as const).map((k) => {
          const s = seats[k];
          return (
            <div key={k} className={`seat card${s?.ready ? ' ready' : ''}`} data-testid={`seat-${k}`}>
              <small className="muted">{k === 'host' ? 'Chủ phòng' : 'Khách'}</small>
              <strong>{s ? s.name : 'Ghế trống'}</strong>
              {s && <span className={`badge${s.ready ? ' ok' : ''}`}>{s.ready ? 'Sẵn sàng' : 'Chưa sẵn sàng'}</span>}
              {k === 'guest' && s && isOwner && (
                <button type="button" className="btn small" disabled={busy} onClick={() => run(() => api.kickGuest(roomId))}>
                  Mời ra
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="row">
        {mySeat && (
          <button
            type="button"
            className="btn primary"
            disabled={busy || meta.status !== 'ready'}
            data-testid="ready-btn"
            onClick={() => run(() => api.setReady(roomId, !seats[mySeat]?.ready))}
          >
            {seats[mySeat]?.ready ? 'Hủy sẵn sàng' : 'Sẵn sàng'}
          </button>
        )}
        {canClaim && (
          <button type="button" className="btn primary" disabled={busy} data-testid="claim-seat" onClick={() => run(() => api.joinRoom(roomId, 'player'))}>
            Vào ghế chơi
          </button>
        )}
        {mySeat && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.leaveRoom(roomId);
                nav('/online');
              })
            }
          >
            {isOwner ? 'Hủy phòng' : 'Rời ghế'}
          </button>
        )}
        {!mySeat && !canClaim && <span className="muted">Bạn đang xem phòng này.</span>}
      </div>

      {isOwner && (
        <div className="card">
          <h2 className="h3">Cài đặt (khóa khi trận bắt đầu)</h2>
          <div className="form-grid">
            <label>
              Hiển thị
              <select
                value={meta.visibility}
                disabled={busy}
                onChange={(e) => run(() => api.updateRoomSettings(roomId, { visibility: e.target.value }))}
              >
                <option value="public">Công khai (hiện ở sảnh)</option>
                <option value="private">Riêng tư (cần lời mời)</option>
              </select>
            </label>
            <label>
              Thời gian
              <select value={meta.tc} disabled={busy} onChange={(e) => run(() => api.updateRoomSettings(roomId, { tc: e.target.value }))}>
                {TC_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Chủ phòng cầm
              <select
                value={meta.ownerColor}
                disabled={busy}
                onChange={(e) => run(() => api.updateRoomSettings(roomId, { ownerColor: e.target.value }))}
              >
                <option value="red">Đỏ</option>
                <option value="black">Đen</option>
                <option value="random">Ngẫu nhiên</option>
              </select>
            </label>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="h3">Mời bạn</h2>
        {meta.visibility === 'public' ? (
          <>
            <p className="muted small">Phòng công khai: ai có link hoặc mã phòng đều vào được (ghế trống) hoặc xem.</p>
            <div className="copy-row">
              <input readOnly value={roomLink} aria-label="Link phòng" />
              <button type="button" className="btn" onClick={() => copy(roomLink)}>
                Sao chép
              </button>
            </div>
            <p className="small">
              Mã phòng: <code>{roomId}</code>
            </p>
          </>
        ) : isOwner ? (
          <>
            <p className="muted small">
              Phòng riêng tư: chỉ người có lời mời hợp lệ mới vào được. Lời mời chơi và lời mời xem tách quyền; mã có hạn 24 giờ và thu hồi được.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={busy}
                data-testid="invite-player"
                onClick={() =>
                  run(async () => {
                    const r = await api.createInvite(roomId, 'player');
                    setInvite({ role: 'player', token: r.token, link: `${window.location.origin}/join/${r.token}` });
                  })
                }
              >
                Tạo lời mời CHƠI
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                data-testid="invite-spectator"
                onClick={() =>
                  run(async () => {
                    const r = await api.createInvite(roomId, 'spectator');
                    setInvite({ role: 'spectator', token: r.token, link: `${window.location.origin}/join/${r.token}` });
                  })
                }
              >
                Tạo lời mời XEM
              </button>
            </div>
            {invite && (
              <div className="invite-box">
                <p className="small">
                  Lời mời <strong>{invite.role === 'player' ? 'chơi' : 'xem'}</strong> (chỉ hiển thị một lần):
                </p>
                <div className="copy-row">
                  <input readOnly value={invite.link} aria-label="Link mời" data-testid="invite-link" />
                  <button type="button" className="btn" onClick={() => copy(invite.link)}>
                    Sao chép link
                  </button>
                </div>
                <div className="copy-row">
                  <input readOnly value={invite.token} aria-label="Mã mời" />
                  <button type="button" className="btn" onClick={() => copy(invite.token)}>
                    Sao chép mã
                  </button>
                </div>
              </div>
            )}
            {invites.data && (
              <ul className="invite-list">
                {Object.entries(invites.data).map(([id, inv]) => (
                  <li key={id}>
                    {inv.role === 'player' ? 'Chơi' : 'Xem'} · hết hạn {new Date(inv.expiresAt).toLocaleString('vi-VN')}{' '}
                    {inv.revoked ? (
                      <span className="badge">Đã thu hồi</span>
                    ) : (
                      <button type="button" className="btn small" disabled={busy} onClick={() => run(() => api.revokeInvite(roomId, id))}>
                        Thu hồi
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="muted small">Chỉ chủ phòng tạo được lời mời cho phòng riêng tư.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Bàn đấu / xem trận
// ---------------------------------------------------------------------------------------------

interface Pending {
  commandId: string;
  expectedVersion: number;
  from: number;
  to: number;
}

function MatchView({
  roomId,
  matchId,
  meta,
  seats,
  uid,
  stats,
}: {
  roomId: string;
  matchId: string;
  meta: RoomMeta;
  seats: Seats;
  uid: string;
  stats: RoomStats | null;
}) {
  const nav = useNavigate();
  const st = useRtdb<MatchState>(`rooms/${roomId}/matches/${matchId}/state`);
  const players = useRtdb<MatchPlayers>(`rooms/${roomId}/matches/${matchId}/players`);
  const { offsetMs } = useConnection();
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [busy, setBusy] = useState(false);
  const mySide: Side | null = players.data ? (players.data.red.uid === uid ? 'red' : players.data.black.uid === uid ? 'black' : null) : null;
  const [flipped, setFlipped] = useState(false);
  const flipInit = useRef(false);
  useEffect(() => {
    if (!flipInit.current && players.data) {
      flipInit.current = true;
      setFlipped(mySide === 'black');
    }
  }, [players.data, mySide]);

  const state = st.data;
  // Ván đã xác nhận (server) – dựng lại từ danh sách nước để có luật/ký hiệu/kiểm tra chiếu.
  const confirmed: Game | null = useMemo(() => {
    if (!state) return null;
    try {
      return replayMoves(state.startFen, state.moves ?? '');
    } catch {
      return null;
    }
  }, [state]);

  // Âm thanh khi có nước mới từ server
  const lastV = useRef<number | null>(null);
  useEffect(() => {
    if (!state || !confirmed) return;
    if (lastV.current !== null && state.v > lastV.current) {
      const rec = confirmed.history[confirmed.history.length - 1];
      if (state.status !== 'playing') playSound('end');
      else if (rec && state.lastMove === rec.iccs) playSound(rec.givesCheck ? 'check' : rec.captured ? 'capture' : 'move');
      else playSound('notify');
    }
    lastV.current = state.v;
    // Nước đi lạc quan đã được xác nhận hoặc bị thay thế bởi version mới => bỏ pending
    if (pending && state.v > pending.expectedVersion) setPending(null);
  }, [state, confirmed, pending]);

  // Bàn hiển thị: bàn xác nhận + nước lạc quan (nếu có)
  const display = useMemo(() => {
    if (!confirmed) return null;
    if (!pending) return confirmed;
    try {
      const g = replayMoves(state!.startFen, state!.moves ?? '');
      g.play(squareToIccs(pending.from) + squareToIccs(pending.to));
      return g;
    } catch {
      return confirmed;
    }
  }, [confirmed, pending, state]);

  const now = useNow(200, state?.status === 'playing');
  const serverNow = now + offsetMs;
  const clocks = useMemo(() => {
    if (!state) return { red: 0, black: 0 };
    const c = { red: state.clock.red, black: state.clock.black };
    if (state.status === 'playing' && state.ply >= 2) c[state.turn] = Math.max(0, c[state.turn] - (serverNow - state.clock.turnStartedAt));
    return c;
  }, [state, serverNow]);
  const firstMoveLeft =
    state && state.status === 'playing' && state.ply < 2 ? Math.max(0, state.clock.turnStartedAt + 30_000 - serverNow) : null;

  const send = useCallback(
    async (type: 'resign' | 'offerDraw' | 'respondDraw' | 'requestUndo' | 'respondUndo' | 'claimTimeout' | 'claimAbandon', accept?: boolean) => {
      if (!state) return;
      setBusy(true);
      try {
        const r = await api.matchAction({ roomId, matchId, commandId: newCommandId(), expectedVersion: state.v, type, accept });
        if (!r.ok && r.code !== 'duplicate') setToast(CODE_VI[r.code] ?? r.message ?? r.code);
      } catch (e) {
        setToast(errorVi(e));
      } finally {
        setBusy(false);
      }
    },
    [roomId, matchId, state],
  );

  // Tự động yêu cầu xử hết giờ khi đồng hồ đối thủ về 0 (server tự kiểm tra lại).
  const claimed = useRef<number>(-1);
  useEffect(() => {
    if (!state || state.status !== 'playing' || !mySide) return;
    const expired = state.ply >= 2 ? clocks[state.turn] <= 0 : (firstMoveLeft ?? 1) <= 0;
    if (expired && claimed.current !== state.v && serverNow > (state.deadline ?? Infinity) + 1500) {
      claimed.current = state.v;
      void send('claimTimeout');
    }
  }, [state, clocks, firstMoveLeft, mySide, serverNow, send]);

  // Theo dõi đối thủ mất kết nối (để hiện nút xử thắng sau 60 giây)
  const oppUid = mySide && players.data ? players.data[mySide === 'red' ? 'black' : 'red'].uid : null;
  const oppOnline = oppUid ? !!stats?.playersOnline?.[oppUid] : null;
  const [oppOfflineSince, setOppOfflineSince] = useState<number | null>(null);
  useEffect(() => {
    if (oppOnline === false) setOppOfflineSince((s) => s ?? Date.now());
    else setOppOfflineSince(null);
  }, [oppOnline]);

  const myTurn = !!state && state.status === 'playing' && mySide === state.turn && !pending;

  const onMove = async (from: number, to: number) => {
    if (!state || !myTurn) return; // chống click đúp: đã có pending thì bỏ qua
    const p: Pending = { commandId: newCommandId(), expectedVersion: state.v, from, to };
    setPending(p);
    const payload = { roomId, matchId, commandId: p.commandId, expectedVersion: p.expectedVersion, from: squareToIccs(from), to: squareToIccs(to) };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await api.submitMove(payload);
        if (!r.ok && r.code !== 'duplicate') {
          setPending(null); // rollback lạc quan
          setToast(CODE_VI[r.code] ?? r.message ?? 'Nước đi bị từ chối');
        }
        return;
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        const retryable = /unavailable|deadline-exceeded|internal|network/i.test(code) || !navigator.onLine;
        if (!retryable || attempt === 2) {
          setPending(null);
          setToast(errorVi(e));
          return;
        }
        // Gửi lại CÙNG commandId: nếu lần trước đã commit mà mất ACK, server trả kết quả cũ.
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  };

  const canSelect = useCallback(
    (sq: number) => {
      if (!myTurn || !display) return false;
      const p = display.position.board[sq];
      return p !== 0 && (p > 0 ? 'red' : 'black') === mySide;
    },
    [myTurn, display, mySide],
  );
  const targetsOf = useCallback((sq: number) => (display ? display.legalTargets(sq) : []), [display]);

  if (st.loading || players.loading) return <Spinner label="Đang tải trận…" />;
  if (st.error) return <ErrorState message={st.error === 'permission_denied' ? 'Bạn không có quyền xem trận này' : st.error} />;
  if (!state || !players.data || !display) return <ErrorState message="Không đọc được dữ liệu trận" />;

  const lm = pending
    ? { from: pending.from, to: pending.to }
    : state.lastMove
      ? { from: iccsToSquare(state.lastMove.slice(0, 2)), to: iccsToSquare(state.lastMove.slice(2)) }
      : null;
  const checkSq = !pending && state.inCheck && state.status === 'playing' ? display.position.kings[state.turn === 'red' ? 0 : 1] : null;
  const top: Side = flipped ? 'red' : 'black';
  const bottom: Side = flipped ? 'black' : 'red';
  const pl = players.data;
  const isPlayer = !!mySide;
  const opp: Side | null = mySide ? (mySide === 'red' ? 'black' : 'red') : null;
  const over = state.status !== 'playing';
  const res = state.result;
  let resultText = '';
  if (res) {
    if (state.status === 'aborted') resultText = 'Trận bị hủy';
    else if (res.winner === 'draw') resultText = 'Hòa';
    else if (mySide) resultText = res.winner === mySide ? 'Bạn thắng!' : 'Bạn thua';
    else resultText = `${pl[res.winner].name} (${res.winner === 'red' ? 'Đỏ' : 'Đen'}) thắng`;
  }
  const isFriendly = meta.mode === 'friendly';
  const rematchMine = !!meta.rematch?.[uid];
  const rematchOther = !!meta.rematch && Object.keys(meta.rematch).some((k) => k !== uid);

  return (
    <div className="game-layout">
      <Toast message={toast} onClose={() => setToast(null)} />
      {confirmResign && (
        <Modal title="Đầu hàng?" onClose={() => setConfirmResign(false)}>
          <p>Bạn chắc chắn muốn đầu hàng ván này?</p>
          <div className="row">
            <button
              type="button"
              className="btn danger"
              data-testid="confirm-resign"
              onClick={() => {
                setConfirmResign(false);
                void send('resign');
              }}
            >
              Đầu hàng
            </button>
            <button type="button" className="btn" onClick={() => setConfirmResign(false)}>
              Hủy
            </button>
          </div>
        </Modal>
      )}
      <section className="board-col">
        <PlayerBar
          name={pl[top].name}
          side={top}
          rating={pl[top].rating}
          clockMs={clocks[top]}
          running={!over && state.turn === top && state.ply >= 2}
          active={!over && state.turn === top}
          online={stats?.playersOnline ? !!stats.playersOnline[pl[top].uid] : null}
        />
        <Board
          board={display.position.board}
          flipped={flipped}
          canSelect={canSelect}
          targetsOf={targetsOf}
          onMove={onMove}
          lastMove={lm}
          checkSq={checkSq}
          pendingTo={pending?.to ?? null}
          disabled={!myTurn}
          ariaLabel={isPlayer ? 'Bàn cờ – trận online' : 'Bàn cờ – chế độ xem'}
        />
        <PlayerBar
          name={pl[bottom].name}
          side={bottom}
          rating={pl[bottom].rating}
          clockMs={clocks[bottom]}
          running={!over && state.turn === bottom && state.ply >= 2}
          active={!over && state.turn === bottom}
          online={stats?.playersOnline ? !!stats.playersOnline[pl[bottom].uid] : null}
        />
      </section>
      <aside className="side-col">
        <div className="card">
          <div className="row between">
            <strong>{meta.mode === 'ranked' ? 'Đấu xếp hạng' : 'Chơi với bạn'}</strong>
            <span className="muted small">
              {tcLabel(meta.tc)} · 👁 <span data-testid="spectators">{stats?.spectators ?? 0}</span>
            </span>
          </div>
          {!isPlayer && <p className="badge">Bạn đang xem (chỉ đọc)</p>}
          {!over && (
            <p className="muted small" aria-live="polite" data-testid="turn-indicator">
              {pending
                ? 'Đang gửi nước đi…'
                : myTurn
                  ? 'Đến lượt bạn'
                  : `Lượt ${state.turn === 'red' ? 'Đỏ' : 'Đen'}`}
              {firstMoveLeft !== null && ` · nước đầu trong ${Math.ceil(firstMoveLeft / 1000)} giây`}
            </p>
          )}
          {state.inCheck && !over && <p className="check-alert">Chiếu tướng!</p>}
          {res && (
            <ResultBanner text={resultText} sub={END_REASON_VI[res.reason]}>
              {isPlayer && isFriendly && meta.status === 'finished' && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || rematchMine}
                  data-testid="rematch"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.requestRematch(roomId);
                    } catch (e) {
                      setToast(errorVi(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {rematchMine ? 'Đã mời đấu lại…' : rematchOther ? 'Chấp nhận đấu lại' : 'Đấu lại'}
                </button>
              )}
              {meta.mode === 'ranked' && isPlayer && (
                <button type="button" className="btn primary" onClick={() => nav('/ranked')}>
                  Tìm trận mới
                </button>
              )}
              {state.status !== 'aborted' && (
                <Link className="btn" to={`/replay/${matchId}`}>
                  Xem lại
                </Link>
              )}
            </ResultBanner>
          )}
          {isPlayer && !over && opp && (
            <>
              {state.drawOffer === opp && (
                <div className="offer" role="alert">
                  Đối thủ đề nghị hòa.
                  <button type="button" className="btn small primary" disabled={busy} onClick={() => send('respondDraw', true)}>
                    Đồng ý
                  </button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => send('respondDraw', false)}>
                    Từ chối
                  </button>
                </div>
              )}
              {state.undoRequest === opp && (
                <div className="offer" role="alert">
                  Đối thủ xin đi lại.
                  <button type="button" className="btn small primary" disabled={busy} onClick={() => send('respondUndo', true)}>
                    Đồng ý
                  </button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => send('respondUndo', false)}>
                    Từ chối
                  </button>
                </div>
              )}
              <div className="actions">
                <button type="button" className="btn danger" disabled={busy} data-testid="resign" onClick={() => setConfirmResign(true)}>
                  Đầu hàng
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || state.drawOffer === mySide || state.ply < 2}
                  data-testid="offer-draw"
                  onClick={() => send('offerDraw')}
                >
                  {state.drawOffer === mySide ? 'Đã đề nghị hòa' : 'Đề nghị hòa'}
                </button>
                {isFriendly && (
                  <button type="button" className="btn" disabled={busy || !!state.undoRequest || state.ply === 0} onClick={() => send('requestUndo')}>
                    Xin đi lại
                  </button>
                )}
                {oppOfflineSince !== null && Date.now() - oppOfflineSince > 60_000 && (
                  <button type="button" className="btn" disabled={busy} onClick={() => send('claimAbandon')}>
                    Xử thắng (đối thủ bỏ trận)
                  </button>
                )}
              </div>
            </>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={() => setFlipped((f) => !f)}>
              Lật bàn
            </button>
            <Link className="btn" to="/online">
              Về sảnh
            </Link>
          </div>
          <SoundControl />
          {oppOnline === false && !over && <p className="muted small">Đối thủ đang mất kết nối. Đồng hồ vẫn chạy.</p>}
        </div>
        <div className="card grow">
          <h2 className="h3">Nước đi</h2>
          <MoveList moves={confirmed?.history.map((h) => h.vn) ?? []} />
        </div>
        <SeatsNote seats={seats} />
      </aside>
    </div>
  );
}

function SeatsNote({ seats }: { seats: Seats }) {
  if (!seats.host) return null;
  return (
    <p className="muted small">
      Chủ phòng: {seats.host.name}
      {seats.guest ? ` · Khách: ${seats.guest.name}` : ''}
    </p>
  );
}

