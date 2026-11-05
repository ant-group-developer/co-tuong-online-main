/** Chọn nhân vật 3D (trang hồ sơ). Xem trước 3D tải lười, chỉ khi người dùng bật. */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AVATAR_IDS, AVATAR_SWATCH, useViewMode, type AvatarId, type Mood } from '../lib/avatars';

const Preview = lazy(() => import('../three/CharacterPreviewCanvas'));
const MOODS: Mood[] = ['idle', 'thinking', 'happy', 'sad', 'surprised', 'wave'];

export function AvatarFace({ id, size = 44 }: { id: AvatarId; size?: number }) {
  const c = AVATAR_SWATCH[id];
  return (
    <span className="avatar-face" aria-hidden="true" style={{ width: size, height: size, background: c.robe, ['--band' as string]: c.band, ['--skin' as string]: c.skin, ['--hair' as string]: c.hair }}>
      <span className="face" />
      <span className="hair" />
      <span className="collar" />
    </span>
  );
}

export function AvatarPicker({ onSaved }: { onSaved?: (msg: string) => void }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [view] = useViewMode();
  const [sel, setSel] = useState<AvatarId>(auth.avatar);
  const [mood, setMood] = useState<Mood>('idle');
  const [show3d, setShow3d] = useState(view === '3d');
  const [saving, setSaving] = useState(false);
  useEffect(() => setSel(auth.avatar), [auth.avatar]);

  const save = async () => {
    setSaving(true);
    try {
      await auth.saveAvatar(sel);
      onSaved?.(t('avatars.saved', { name: t(`avatars.${sel}.name`) }));
    } catch (e) {
      onSaved?.(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card stack" data-testid="avatar-picker">
      <div className="stack-tight">
        <h2 className="h3">{t('avatars.title')}</h2>
        <p className="muted small">{t('avatars.intro')}</p>
      </div>
      <div className="avatar-layout">
        <div className="avatar-preview">
          {show3d ? (
            <>
              <Suspense fallback={<div className="char-preview loading">{t('view3d.loading')}</div>}>
                <Preview avatar={sel} mood={mood} />
              </Suspense>
              <div className="chips" role="group" aria-label={t('avatars.moodLabel')}>
                {MOODS.map((m) => (
                  <button key={m} type="button" className={`chip${mood === m ? ' checked' : ''}`} aria-pressed={mood === m} onClick={() => setMood(m)}>
                    {t(`avatars.moods.${m}`)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setShow3d(true)} data-testid="avatar-show3d">
              {t('avatars.show3d')}
            </button>
          )}
        </div>
        <div className="avatar-grid" role="radiogroup" aria-label={t('avatars.title')}>
          {AVATAR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={sel === id}
              className={`avatar-card${sel === id ? ' on' : ''}`}
              onClick={() => setSel(id)}
              data-testid={`avatar-${id}`}
            >
              <AvatarFace id={id} />
              <span className="stack-tight">
                <strong>{t(`avatars.${id}.name`)}</strong>
                <span className="muted small">{t(`avatars.${id}.desc`)}</span>
              </span>
              {auth.avatar === id && (
                <span className="avatar-active" role="img" aria-label={t('avatars.inUse')} title={t('avatars.inUse')} data-testid="avatar-active">
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M3.2 8.4 6.4 11.4 12.8 4.8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {sel !== auth.avatar && (
        <div className="row">
          <button type="button" className="btn primary" disabled={saving} onClick={save} data-testid="avatar-save">
            {t('avatars.use', { name: t(`avatars.${sel}.name`) })}
          </button>
        </div>
      )}
    </section>
  );
}
