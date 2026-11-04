import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorState, NotConfigured, Spinner } from '../components/common';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';

/** /join/:token – đổi lời mời thành quyền theo UID (backend redeem), rồi vào phòng. */
export function JoinPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const auth = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!auth.configured || !auth.ready || done.current) return;
    done.current = true;
    (async () => {
      try {
        await auth.ensureSignedIn();
        const r = await api.redeemInvite(token);
        if (r.role === 'player') {
          try {
            await api.joinRoom(r.roomId, 'player');
          } catch {
            /* ghế đã có người – vẫn vào phòng để xem */
          }
        }
        nav(`/room/${r.roomId}`, { replace: true });
      } catch (e) {
        setError(errorText(e));
      }
    })();
  }, [auth, token, nav]);

  if (!auth.configured) return <NotConfigured />;
  if (error)
    return (
      <ErrorState
        title={t('join.failed')}
        message={error}
        action={
          <Link className="btn" to="/online">
            {t('common.backToLobby')}
          </Link>
        }
      />
    );
  return <Spinner label={t('join.checking')} />;
}
