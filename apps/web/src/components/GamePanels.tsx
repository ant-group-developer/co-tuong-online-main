import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock } from './common';

export function PlayerBar({
  name,
  side,
  clockMs,
  running,
  active,
  online,
  rating,
  note,
}: {
  name: string;
  side: 'red' | 'black';
  clockMs?: number | null;
  running?: boolean;
  active?: boolean;
  online?: boolean | null;
  rating?: number | null;
  note?: string;
}) {
  const { t } = useTranslation();
  const low = clockMs !== null && clockMs !== undefined && clockMs < 20_000;
  return (
    <div className={`player-bar ${side}${active ? ' active' : ''}`} data-testid={`player-${side}`}>
      <span className={`side-dot ${side}`} aria-hidden="true" />
      <div className="player-name">
        <strong>{name}</strong>
        <small>
          {t(`side.${side}`)}
          {rating ? ` · ${rating}` : ''}
          {online === false ? ` · ${t('panel.offline')}` : online ? ` · ${t('panel.online')}` : ''}
          {note ? ` · ${note}` : ''}
        </small>
      </div>
      {clockMs !== null && clockMs !== undefined && (
        <div
          className={`clock${running ? ' running' : ''}${low ? ' low' : ''}`}
          role="timer"
          aria-label={t('panel.clockOf', { side: t(`side.${side}`) })}
          data-testid={`clock-${side}`}
        >
          {formatClock(clockMs)}
        </div>
      )}
    </div>
  );
}

export function MoveList({ moves, current, onSelect }: { moves: string[]; current?: number; onSelect?: (ply: number) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (current === undefined || current >= moves.length) ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [moves.length, current]);
  const rows: Array<[string, string | undefined, number]> = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1], i]);
  return (
    <div className="move-list" aria-label={t('panel.moveHistory')}>
      {moves.length === 0 ? (
        <p className="muted small">{t('panel.noMoves')}</p>
      ) : (
        <ol ref={ref}>
          {rows.map(([r, b, i]) => (
            <li key={i}>
              <span className="mv-no">{i / 2 + 1}.</span>
              <button type="button" className={`mv red${current === i + 1 ? ' cur' : ''}`} onClick={() => onSelect?.(i + 1)} disabled={!onSelect}>
                {r}
              </button>
              {b !== undefined && (
                <button
                  type="button"
                  className={`mv black${current === i + 2 ? ' cur' : ''}`}
                  onClick={() => onSelect?.(i + 2)}
                  disabled={!onSelect}
                >
                  {b}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ResultBanner({ text, sub, children }: { text: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="result-banner" role="status" aria-live="polite" data-testid="result-banner">
      <strong>{text}</strong>
      {sub && <span>{sub}</span>}
      {children && <div className="row">{children}</div>}
    </div>
  );
}
