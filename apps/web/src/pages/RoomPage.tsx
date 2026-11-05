/**
 * Phòng online: phòng chờ (mời bạn, sẵn sàng), bàn đấu cho người chơi, chế độ xem cho khán giả.
 * Nước đi gửi lên server dạng intent (commandId + expectedVersion); chỉ coi là chấp nhận khi RTDB có version mới.
 */
import { iccsToSquare, replayMoves, squareToIccs, type Game, type Side } from '@xq/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BoardView, ViewToggle } from '../components/BoardView';
import { ErrorState, Modal, NotConfigured, SoundControl, Spinner, Toast, useNow } from '../components/common';
import { MoveList, PlayerBar, ResultBanner } from '../components/GamePanels';
import { fmtDateTime, moveText } from '../i18n';
import { api, commandText, errorText, newCommandId, tcLabel, TC_OPTIONS } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConnection, useRoomPresence, useRtdb } from '../lib/rtdb';
import { useViewMode, type EmoteId, type Mood, type SeatVisual } from '../lib/avatars';
import { sendEmote, useAvatarOf, useRoomEmotes } from '../lib/seatVisuals';
import { playSound } from '../lib/sound';
import type { MatchPlayers, MatchState, RoomMeta, RoomStats, Seats } from '../lib/types';

export function RoomPage() {
  const { t } = useTranslation();
  const { roomId = '' } = useParams();
  const auth = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.configured && auth.ready && !auth.user) auth.ensureSignedIn().catch((e) => setSignInError(errorText(e)));
  }, [auth]);

  if (!auth.configured) return <NotConfigured />;
  if (signInError) return <ErrorState title={t('common.signInFailed')} message={signInError} />;
  if (!auth.ready || !auth.user) return <Spinner label={t('common.connecting')} />;
  return <RoomInner roomId={roomId} uid={auth.user.uid} />;
}

function RoomInner({ roomId, uid }: { roomId: string; uid: string }) {
  const { t } = useTranslation();
  const meta = useRtdb<RoomMeta>(`rooms/${roomId}/meta`);
  const seats = useRtdb<Seats>(`rooms/${roomId}/seats`);
  const myMember = useRtdb<{ role: string }>(`rooms/${roomId}/members/${uid}`);
  const stats = useRtdb<RoomStats>(`roomStats/${roomId}`);
  const { connected } = useConnection();
  const canView = !!meta.data && !meta.error;
  useRoomPresence(roomId, uid, canView);

  if (meta.loading) return <Spinner label={t('room.loading')} />;
  if (meta.error === 'permission_denied')
    return (
      <ErrorState
        title={t('room.privateTitle')}
        message={t('room.privateMsg')}
        action={
          <Link className="btn" to="/online">
            {t('common.backToLobby')}
          </Link>
        }
      />
    );
  if (meta.error) return <ErrorState message={meta.error} />;
  if (!meta.data)
    return (
      <ErrorState
        title={t('room.notFound')}
        message={t('room.notFoundMsg')}
        action={
          <Link className="btn" to="/online">
            {t('common.backToLobby')}
          </Link>
        }
      />
    );

  const m = meta.data;
  return (
    <>
      {!connected && <div className="banner warn" role="status">{t('room.disconnected')}</div>}
      {m.matchId ? (
        <MatchView roomId={roomId} matchId={m.matchId} meta={m} seats={seats.data ?? {}} uid={uid} stats={stats.data} />
      ) : m.status === 'cancelled' ? (
        <ErrorState
          title={t('room.cancelled')}
          action={
            <Link className="btn" to="/online">
              {t('common.backToLobby')}
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
  const { t } = useTranslation();
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
      setToast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(t('common.copied'));
    } catch {
      setToast(t('common.copyFailed'));
    }
  };

  const canClaim = !mySeat && !seats.guest && meta.status === 'waiting' && meta.mode === 'friendly' && (meta.visibility === 'public' || memberRole === 'player');
  const statusText = meta.status === 'waiting' ? t('room.statusWaiting') : meta.status === 'ready' ? t('room.statusReady') : meta.status;

  return (
    <div className="page narrow stack">
      <Toast message={toast} onClose={() => setToast(null)} />
      <header className="room-head">
        <h1>{t('room.title', { roomId })}</h1>
        <div className="chips">
          <span className="badge">{meta.visibility === 'public' ? t('room.public') : t('room.private')}</span>
          <span className="badge">{tcLabel(meta.tc)}</span>
          <span className="badge">{t('room.friendlyBadge')}</span>
          <span className="badge ok" data-testid="room-status">
            {statusText}
          </span>
          <span className="badge">{t('room.spectators', { count: stats?.spectators ?? 0 })}</span>
        </div>
      </header>

      <div className="seats">
        {(['host', 'guest'] as const).map((k) => {
          const s = seats[k];
          return (
            <div key={k} className={`seat card${s?.ready ? ' ready' : ''}${s?.uid === uid ? ' me' : ''}`} data-testid={`seat-${k}`}>
              <small className="muted">{k === 'host' ? t('room.host') : t('room.opponent')}</small>
              <strong className="seat-name">
                {s ? s.name : t('room.emptySeat')}
                {s?.uid === uid && <span className="muted small"> ({t('common.you')})</span>}
              </strong>
              {s && <span className={`badge${s.ready ? ' ok' : ''}`}>{s.ready ? t('room.ready') : t('room.notReady')}</span>}
              {k === 'guest' && s && isOwner && (
                <button type="button" className="btn small" disabled={busy} onClick={() => run(() => api.kickGuest(roomId))}>
                  {t('room.kick')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <section className="card stack room-actions" aria-label={t('room.actions')}>
        {mySeat && meta.status === 'waiting' && <p className="muted small">{t('room.waitingHint')}</p>}
        {mySeat && meta.status === 'ready' && <p className="muted small">{t('room.readyHint')}</p>}
        <div className="row">
        {mySeat && (
          <button
            type="button"
            className="btn primary"
            disabled={busy || meta.status !== 'ready'}
            data-testid="ready-btn"
            onClick={() => run(() => api.setReady(roomId, !seats[mySeat]?.ready))}
          >
            {seats[mySeat]?.ready ? t('room.unready') : t('room.ready')}
          </button>
        )}
        {canClaim && (
          <button type="button" className="btn primary" disabled={busy} data-testid="claim-seat" onClick={() => run(() => api.joinRoom(roomId, 'player'))}>
            {t('room.claimSeat')}
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
            {isOwner ? t('room.cancelRoom') : t('room.leaveSeat')}
          </button>
        )}
        {!mySeat && !canClaim && <span className="muted">{t('room.watching')}</span>}
        </div>
      </section>

      {isOwner && (
        <section className="card stack">
          <h2 className="h3">{t('room.settings')}</h2>
          <p className="muted small">{t('room.settingsNote')}</p>
          <div className="form-grid">
            <label>
              {t('room.visibility')}
              <select
                value={meta.visibility}
                disabled={busy}
                onChange={(e) => run(() => api.updateRoomSettings(roomId, { visibility: e.target.value }))}
              >
                <option value="public">{t('room.publicOpt')}</option>
                <option value="private">{t('room.privateOpt')}</option>
              </select>
            </label>
            <label>
              {t('room.time')}
              <select value={meta.tc} disabled={busy} onChange={(e) => run(() => api.updateRoomSettings(roomId, { tc: e.target.value }))}>
                {TC_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {tcLabel(o.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('room.ownerColor')}
              <select
                value={meta.ownerColor}
                disabled={busy}
                onChange={(e) => run(() => api.updateRoomSettings(roomId, { ownerColor: e.target.value }))}
              >
                <option value="red">{t('side.red')}</option>
                <option value="black">{t('side.black')}</option>
                <option value="random">{t('side.random')}</option>
              </select>
            </label>
          </div>
        </section>
      )}

      <section className="card stack">
        <h2 className="h3">{t('room.invite')}</h2>
        {meta.visibility === 'public' ? (
          <>
            <p className="muted small">{t('room.publicNote')}</p>
            <div className="invite-box">
              <div className="invite-field">
                <span className="muted small">{t('room.roomLink')}</span>
                <div className="copy-row">
                  <input readOnly value={roomLink} aria-label={t('room.roomLink')} />
                  <button type="button" className="btn" onClick={() => copy(roomLink)}>
                    {t('room.copyLink')}
                  </button>
                </div>
              </div>
              <div className="invite-field">
                <span className="muted small">{t('room.roomCode')}</span>
                <div className="copy-row">
                  <input readOnly value={roomId} aria-label={t('room.roomCode')} className="code-input" />
                  <button type="button" className="btn" onClick={() => copy(roomId)}>
                    {t('room.copyCode')}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : isOwner ? (
          <>
            <p className="muted small">
              {t('room.privateNote')}
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
                {t('room.invitePlayer')}
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
                {t('room.inviteSpectator')}
              </button>
            </div>
            {invite && (
              <div className="invite-box">
                <p className="small invite-title">
                  <Trans i18nKey={invite.role === 'player' ? 'room.inviteOnce_player' : 'room.inviteOnce_spectator'} components={{ b: <strong /> }} />
                </p>
                <div className="invite-field">
                  <span className="muted small">{t('room.inviteLink')}</span>
                  <div className="copy-row">
                    <input readOnly value={invite.link} aria-label={t('room.inviteLink')} data-testid="invite-link" />
                    <button type="button" className="btn" onClick={() => copy(invite.link)}>
                      {t('room.copyLink')}
                    </button>
                  </div>
                </div>
                <div className="invite-field">
                  <span className="muted small">{t('room.inviteCode')}</span>
                  <div className="copy-row">
                    <input readOnly value={invite.token} aria-label={t('room.inviteCode')} />
                    <button type="button" className="btn" onClick={() => copy(invite.token)}>
                      {t('room.copyCode')}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {invites.data && (
              <ul className="invite-list">
                {Object.entries(invites.data).map(([id, inv]) => (
                  <li key={id}>
                    {inv.role === 'player' ? t('room.inviteRolePlayer') : t('room.inviteRoleSpectator')} · {t('room.expires', { time: fmtDateTime(inv.expiresAt) })}{' '}
                    {inv.revoked ? (
                      <span className="badge">{t('room.revoked')}</span>
                    ) : (
                      <button type="button" className="btn small" disabled={busy} onClick={() => run(() => api.revokeInvite(roomId, id))}>
                        {t('room.revoke')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="muted small">{t('room.ownerOnlyInvite')}</p>
        )}
      </section>
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
  const { t } = useTranslation();
  const nav = useNavigate();
  const st = useRtdb<MatchState>(`rooms/${roomId}/matches/${matchId}/state`);
  const players = useRtdb<MatchPlayers>(`rooms/${roomId}/matches/${matchId}/players`);
  const { offsetMs } = useConnection();
  const [view] = useViewMode();
  const redAvatar = useAvatarOf(players.data?.red.uid);
  const blackAvatar = useAvatarOf(players.data?.black.uid);
  const emotes = useRoomEmotes(roomId, offsetMs);
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
        if (!r.ok && r.code !== 'duplicate') setToast(commandText(r));
      } catch (e) {
        setToast(errorText(e));
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
          setToast(r.message || r.messageKey || r.code ? commandText(r) : t('room.rejected'));
        }
        return;
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        const retryable = /unavailable|deadline-exceeded|internal|network/i.test(code) || !navigator.onLine;
        if (!retryable || attempt === 2) {
          setPending(null);
          setToast(errorText(e));
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

  if (st.loading || players.loading) return <Spinner label={t('room.loadingMatch')} />;
  if (st.error) return <ErrorState message={st.error === 'permission_denied' ? t('room.noAccess') : st.error} />;
  if (!state || !players.data || !display) return <ErrorState message={t('room.readFailed')} />;

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
    if (state.status === 'aborted') resultText = t('room.aborted');
    else if (res.winner === 'draw') resultText = t('room.draw');
    else if (mySide) resultText = res.winner === mySide ? t('room.youWin') : t('room.youLose');
    else resultText = t('room.winnerIs', { name: pl[res.winner].name, side: t(`side.${res.winner}`) });
  }
  const isFriendly = meta.mode === 'friendly';
  const rematchMine = !!meta.rematch?.[uid];
  const rematchOther = !!meta.rematch && Object.keys(meta.rematch).some((k) => k !== uid);
  // Bàn 3D: nhân vật, nét mặt (đang nghĩ / thắng / thua) và biểu cảm của từng người.
  const moodOf = (s: Side): Mood => {
    if (over) return !res || res.winner === 'draw' || state.status === 'aborted' ? 'idle' : res.winner === s ? 'happy' : 'sad';
    return state.turn === s && s !== mySide ? 'thinking' : 'idle';
  };
  const seat = (s: Side): SeatVisual => {
    const e = emotes[pl[s].uid];
    return { avatar: s === 'red' ? redAvatar : blackAvatar, mood: moodOf(s), emote: e ? { id: e.id, at: e.at } : null };
  };
  const onEmote = isPlayer
    ? (e: EmoteId) => {
        sendEmote(roomId, uid, e).catch(() => setToast(t('view3d.emotes.tooFast')));
      }
    : undefined;

  return (
    <div className={`game-layout${view === '3d' ? ' is-3d' : ''}`}>
      <Toast message={toast} onClose={() => setToast(null)} />
      {confirmResign && (
        <Modal title={t('room.resignTitle')} onClose={() => setConfirmResign(false)}>
          <p>{t('room.resignConfirm')}</p>
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
              {t('common.resign')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmResign(false)}>
              {t('common.cancel')}
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
        <BoardView
          top={seat(top)}
          bottom={seat(bottom)}
          onEmote={onEmote}
          board={display.position.board}
          flipped={flipped}
          canSelect={canSelect}
          targetsOf={targetsOf}
          onMove={onMove}
          lastMove={lm}
          checkSq={checkSq}
          pendingTo={pending?.to ?? null}
          disabled={!myTurn}
          ariaLabel={isPlayer ? t('board.online') : t('board.spectate')}
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
            <strong>{meta.mode === 'ranked' ? t('room.rankedGame') : t('room.friendlyGame')}</strong>
            <span className="muted small">
              {tcLabel(meta.tc)} · 👁 <span data-testid="spectators">{stats?.spectators ?? 0}</span>
            </span>
          </div>
          {!isPlayer && <p className="badge">{t('room.spectatorBadge')}</p>}
          {!over && (
            <p className="muted small" aria-live="polite" data-testid="turn-indicator">
              {pending
                ? t('room.sending')
                : myTurn
                  ? t('room.yourTurn')
                  : t('room.turnOf', { side: t(`side.${state.turn}`) })}
              {firstMoveLeft !== null && t('room.firstMove', { seconds: Math.ceil(firstMoveLeft / 1000) })}
            </p>
          )}
          {state.inCheck && !over && <p className="check-alert">{t('room.check')}</p>}
          {res && (
            <ResultBanner text={resultText} sub={t(`endReason.${res.reason}`)}>
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
                      setToast(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {rematchMine ? t('room.rematchSent') : rematchOther ? t('room.rematchAccept') : t('room.rematch')}
                </button>
              )}
              {meta.mode === 'ranked' && isPlayer && (
                <button type="button" className="btn primary" onClick={() => nav('/ranked')}>
                  {t('room.findNew')}
                </button>
              )}
              {state.status !== 'aborted' && (
                <Link className="btn" to={`/replay/${matchId}`}>
                  {t('common.replay')}
                </Link>
              )}
            </ResultBanner>
          )}
          {isPlayer && !over && opp && (
            <>
              {state.drawOffer === opp && (
                <div className="offer" role="alert">
                  {t('room.drawOffered')}
                  <button type="button" className="btn small primary" disabled={busy} onClick={() => send('respondDraw', true)}>
                    {t('common.accept')}
                  </button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => send('respondDraw', false)}>
                    {t('common.decline')}
                  </button>
                </div>
              )}
              {state.undoRequest === opp && (
                <div className="offer" role="alert">
                  {t('room.undoRequested')}
                  <button type="button" className="btn small primary" disabled={busy} onClick={() => send('respondUndo', true)}>
                    {t('common.accept')}
                  </button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => send('respondUndo', false)}>
                    {t('common.decline')}
                  </button>
                </div>
              )}
              <div className="actions">
                <button type="button" className="btn danger" disabled={busy} data-testid="resign" onClick={() => setConfirmResign(true)}>
                  {t('common.resign')}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || state.drawOffer === mySide || state.ply < 2}
                  data-testid="offer-draw"
                  onClick={() => send('offerDraw')}
                >
                  {state.drawOffer === mySide ? t('room.drawSent') : t('room.offerDraw')}
                </button>
                {isFriendly && (
                  <button type="button" className="btn" disabled={busy || !!state.undoRequest || state.ply === 0} onClick={() => send('requestUndo')}>
                    {t('room.requestUndo')}
                  </button>
                )}
                {oppOfflineSince !== null && Date.now() - oppOfflineSince > 60_000 && (
                  <button type="button" className="btn" disabled={busy} onClick={() => send('claimAbandon')}>
                    {t('room.claimAbandon')}
                  </button>
                )}
              </div>
            </>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={() => setFlipped((f) => !f)}>
              {t('common.flipBoard')}
            </button>
            <Link className="btn" to="/online">
              {t('common.backToLobby')}
            </Link>
          </div>
          <SoundControl />
          <ViewToggle />
          {oppOnline === false && !over && <p className="muted small">{t('room.oppOffline')}</p>}
        </div>
        <div className="card grow">
          <h2 className="h3">{t('panel.moves')}</h2>
          <MoveList moves={confirmed?.history.map(moveText) ?? []} />
        </div>
        <SeatsNote seats={seats} />
      </aside>
    </div>
  );
}

function SeatsNote({ seats }: { seats: Seats }) {
  const { t } = useTranslation();
  if (!seats.host) return null;
  return (
    <p className="muted small">
      {t('room.seatsNote', { host: seats.host.name })}
      {seats.guest ? t('room.seatsNoteGuest', { guest: seats.guest.name }) : ''}
    </p>
  );
}

