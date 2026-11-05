/**
 * Chọn cách hiển thị bàn cờ: 2D (SVG, mặc định) hoặc 3D (three.js, tải lười).
 * Lựa chọn được lưu trên trình duyệt và dùng chung cho chơi với máy lẫn phòng online.
 */
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useViewMode, type EmoteId, type SeatVisual } from '../lib/avatars';
import { Board, type BoardProps } from './Board';

const Board3D = lazy(() => import('../three/Board3D'));

export interface BoardViewProps extends BoardProps {
  top: SeatVisual;
  bottom: SeatVisual;
  onEmote?: (e: EmoteId) => void;
}

export function BoardView(props: BoardViewProps) {
  const [mode] = useViewMode();
  const { t } = useTranslation();
  if (mode !== '3d') {
    const { top: _t, bottom: _b, onEmote: _e, ...rest } = props;
    void _t;
    void _b;
    void _e;
    return <Board {...rest} />;
  }
  return (
    <Suspense
      fallback={
        <div className="board3d loading" role="status">
          <span className="muted">{t('view3d.loading')}</span>
        </div>
      }
    >
      <Board3D {...props} />
    </Suspense>
  );
}

/** Nút chuyển 2D / 3D. */
export function ViewToggle() {
  const [mode, setMode] = useViewMode();
  const { t } = useTranslation();
  return (
    <div className="view-toggle" role="group" aria-label={t('view3d.label')}>
      <span className="muted small">{t('view3d.label')}</span>
      <div className="seg-btns">
        {(['2d', '3d'] as const).map((m) => (
          <button key={m} type="button" className={`btn small${mode === m ? ' primary' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)} data-testid={`view-${m}`}>
            {t(`view3d.${m}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
