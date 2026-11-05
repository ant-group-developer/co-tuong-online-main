/** Khung xem trước nhân vật 3D (trang hồ sơ). Tải lười cùng three.js. */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AvatarId, Mood } from '../lib/avatars';
import { CharacterPreview } from './scene';

export default function CharacterPreviewCanvas({ avatar, mood }: { avatar: AvatarId; mood: Mood }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const preview = useRef<CharacterPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    let p: CharacterPreview;
    try {
      p = new CharacterPreview(ref.current, avatar);
    } catch {
      setFailed(true);
      return;
    }
    preview.current = p;
    return () => {
      preview.current = null;
      p.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => preview.current?.setCharacter(avatar), [avatar]);
  useEffect(() => preview.current?.setMood(mood), [mood]);

  if (failed) return <p className="muted small">{t('view3d.failedShort')}</p>;
  return (
    <div className="char-preview">
      <canvas ref={ref} role="img" aria-label={t('avatars.previewOf', { name: t(`avatars.${avatar}.name`) })} />
    </div>
  );
}
