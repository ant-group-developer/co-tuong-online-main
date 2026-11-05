/**
 * Bàn cờ 3D: cùng giao diện props với <Board> 2D (bàn canonical, chọn quân, đích hợp lệ, onMove),
 * thêm hình ảnh hai ghế (nhân vật, trạng thái, biểu cảm). Tải lười cùng three.js (chunk riêng).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Board, type BoardProps } from '../components/Board';
import { useCamPreset, useGlyphFacing, useViewMode, type EmoteId, type SeatVisual } from '../lib/avatars';
import { BoardScene } from './scene';

export interface Board3DProps extends BoardProps {
  top: SeatVisual;
  bottom: SeatVisual;
  /** Có thì hiện nút biểu cảm (người chơi). */
  onEmote?: (e: EmoteId) => void;
}

const CAMS = ['third', 'seat', 'top'] as const;
const EMOTE_BTNS: EmoteId[] = ['wave', 'happy', 'thinking'];

export default function Board3D(props: Board3DProps) {
  const { board, flipped = false, canSelect, targetsOf, onMove, lastMove, checkSq, disabled, ariaLabel, top, bottom, onEmote } = props;
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [cam, setCam] = useCamPreset();
  const [glyph, setGlyph] = useGlyphFacing();
  const [, setView] = useViewMode();
  const boardKey = Array.prototype.join.call(board, ',');

  const targets = useMemo(() => (selected !== null && targetsOf ? targetsOf(selected) : []), [selected, targetsOf]);

  // Chạm ô: luôn dùng props mới nhất (cảnh 3D giữ một callback cố định).
  const tapRef = useRef<(sq: number) => void>(() => undefined);
  tapRef.current = (sq: number) => {
    if (disabled) return;
    if (selected !== null && targets.includes(sq)) {
      onMove?.(selected, sq);
      setSelected(null);
      return;
    }
    if (sq >= 0 && canSelect?.(sq)) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  };

  // Tạo cảnh một lần
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: BoardScene;
    try {
      scene = new BoardScene(canvas, {
        flipped,
        top: top.avatar,
        bottom: bottom.avatar,
        camera: cam,
        glyphFacing: glyph,
        onTap: (sq) => tapRef.current(sq),
      });
    } catch {
      setFailed(true);
      return;
    }
    sceneRef.current = scene;
    // Hook cho E2E (chỉ bản dev/emulator): chiếu ô lên màn hình để bấm đúng chỗ trên cảnh 3D.
    const testHook = import.meta.env.DEV || import.meta.env.MODE === 'emulator';
    if (testHook) (window as unknown as { __xq3d?: unknown }).__xq3d = { screenOf: (c: number, r: number) => scene.screenOf(c, r) };
    return () => {
      sceneRef.current = null;
      if (testHook) delete (window as unknown as { __xq3d?: unknown }).__xq3d;
      scene.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setSelected(null), [boardKey, disabled]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.setFlipped(flipped);
    const checkSide = checkSq != null && board[checkSq] ? (board[checkSq] > 0 ? 'red' : 'black') : null;
    s.setBoard(board, lastMove ?? null, checkSide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, flipped, lastMove?.from, lastMove?.to, checkSq]);

  useEffect(() => {
    sceneRef.current?.setMarks(selected, targets, lastMove ?? null, checkSq ?? null);
  }, [selected, targets, lastMove, checkSq, boardKey]);

  useEffect(() => sceneRef.current?.setAvatar('top', top.avatar), [top.avatar]);
  useEffect(() => sceneRef.current?.setAvatar('bottom', bottom.avatar), [bottom.avatar]);
  useEffect(() => sceneRef.current?.setBaseMood('top', top.mood ?? 'idle'), [top.mood, top.avatar]);
  useEffect(() => sceneRef.current?.setBaseMood('bottom', bottom.mood ?? 'idle'), [bottom.mood, bottom.avatar]);
  useEffect(() => {
    if (top.emote) sceneRef.current?.emote('top', top.emote.id);
  }, [top.emote?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (bottom.emote) sceneRef.current?.emote('bottom', bottom.emote.id);
  }, [bottom.emote?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => sceneRef.current?.setCamera(cam), [cam]);
  useEffect(() => sceneRef.current?.setGlyphFacing(glyph), [glyph]);

  if (failed) {
    return (
      <div className="board3d-fallback">
        <p className="muted small" role="status">
          {t('view3d.failed')}
        </p>
        <Board {...props} />
      </div>
    );
  }

  return (
    <div className={`board3d${disabled ? ' is-disabled' : ''}`} data-testid="board3d">
      <canvas ref={canvasRef} aria-label={`${ariaLabel ?? t('board.label')}. ${t('view3d.boardHint')}`} role="img" />
      <div className="board3d-bar">
        <div className="seg" role="group" aria-label={t('view3d.camera')}>
          {CAMS.map((c) => (
            <button key={c} type="button" aria-pressed={cam === c} onClick={() => setCam(c)} data-testid={`cam-${c}`}>
              {t(`view3d.cams.${c}`)}
            </button>
          ))}
          <button type="button" className="icon" onClick={() => sceneRef.current?.resetView()} aria-label={t('view3d.resetView')} title={t('view3d.resetView')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </button>
        </div>
        <div className="seg">
          <button
            type="button"
            onClick={() => setGlyph(glyph === 'owner' ? 'viewer' : 'owner')}
            title={t(`view3d.glyph.${glyph === 'owner' ? 'viewer' : 'owner'}`)}
            aria-label={t(`view3d.glyph.${glyph === 'owner' ? 'viewer' : 'owner'}`)}
          >
            {glyph === 'owner' ? '將↻' : '將↺'}
          </button>
          <button type="button" onClick={() => setView('2d')} data-testid="view-2d-inline">
            2D
          </button>
        </div>
      </div>
      {onEmote && (
        <div className="board3d-bar bottom">
          <div className="seg" role="group" aria-label={t('view3d.emotes.label')}>
            {EMOTE_BTNS.map((e) => (
              <button key={e} type="button" onClick={() => onEmote(e)} data-testid={`emote-${e}`}>
                {t(`view3d.emotes.${e}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
