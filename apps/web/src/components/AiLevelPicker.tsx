import type { AiLevel } from '@xq/engine/ai';
import type { Side } from '@xq/engine';
import { useTranslation } from 'react-i18next';
import { LEVEL_INFO, type Record3, type Records } from '../ai/levels';

export type ColorChoice = Side | 'random';

export function Stars({ n, max = 6 }: { n: number; max?: number }) {
  const { t } = useTranslation();
  return (
    <span className="stars" aria-label={t('levels.strength', { n, max })}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < n ? 'on' : ''} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

/** Thành tích gọn (T · H · B); rỗng nếu chưa đấu mức này. */
export function useRecordText(): (r?: Record3) => string {
  const { t } = useTranslation();
  return (r) => (!r || r.w + r.d + r.l === 0 ? '' : t('levels.record', { w: r.w, d: r.d, l: r.l }));
}

/** Lưới 6 thẻ chọn mức máy (radio). Mỗi thẻ: số mức, tên, độ mạnh, nhãn ngắn, thành tích (nếu có). */
export function AiLevelPicker({
  value,
  onChange,
  records,
  current,
  name = 'level',
}: {
  value: AiLevel;
  onChange: (lv: AiLevel) => void;
  records: Records;
  /** Mức đang đấu (đánh dấu "Đang đấu") */
  current?: AiLevel;
  name?: string;
}) {
  const { t } = useTranslation();
  const recordText = useRecordText();
  return (
    <div className="level-grid" role="radiogroup" aria-label={t('ai.pickerLabel')}>
      {LEVEL_INFO.map((l) => {
        const hint = t(`levels.${l.level}.hint`);
        const badge = current === l.level ? <span className="badge ok level-badge">{t('levels.current')}</span> : hint ? <span className="badge level-badge">{hint}</span> : null;
        const rec = recordText(records[l.level]);
        return (
          <label key={l.level} className={`level-card${value === l.level ? ' checked' : ''}`} data-level={l.level}>
            <input type="radio" name={name} value={l.level} checked={value === l.level} onChange={() => onChange(l.level)} />
            <span className="level-num" aria-hidden="true">
              {l.stars}
            </span>
            <strong className="level-name">{t(`levels.${l.level}.name`)}</strong>
            <Stars n={l.stars} />
            {badge}
            {rec && <span className="level-rec">{rec}</span>}
          </label>
        );
      })}
    </div>
  );
}

export function ColorPicker({ value, onChange, name = 'color' }: { value: ColorChoice; onChange: (c: ColorChoice) => void; name?: string }) {
  const { t } = useTranslation();
  const opts: Array<[ColorChoice, string]> = [
    ['red', t('side.redFirst')],
    ['black', t('side.black')],
    ['random', t('side.random')],
  ];
  return (
    <div className="row" role="radiogroup" aria-label={t('ai.colorLabel')}>
      {opts.map(([v, label]) => (
        <label key={v} className={`chip${value === v ? ' checked' : ''}`}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}
