/**
 * Đấu xếp hạng: server ghép đối thủ theo rating + thời gian. Không chọn đối thủ, không dùng link mời.
 */
import { onValue, ref } from 'firebase/database';
import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { NotConfigured, Spinner, useNow } from '../components/common';
import { alreadyInRoomOf, api, errorText, tcLabel, TC_OPTIONS, type Tc } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fb } from '../lib/firebase';
import { useMyActiveRoom } from '../lib/myroom';

export function RankedPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const nav = useNavigate();
  const [tc, setTc] = useState<Tc>('5+0');
  const [searching, setSearching] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const active = useRef(false);
  const now = useNow(1000, searching);
  const myRoom = useMyActiveRoom();
  const inFriendly = myRoom?.mode === 'friendly';

  const stop = () => {
    active.current = false;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setSearching(false);
  };

  // Nghe assignment realtime để vào trận ngay khi được ghép (không phải chờ lượt poll).
  useEffect(() => {
    if (!auth.user || !auth.configured) return;
    return onValue(ref(fb().db, `mm/assign/${auth.user.uid}`), (s) => {
      const a = s.val() as { roomId?: string } | null;
      if (a?.roomId && active.current) {
        stop();
        nav(`/room/${a.roomId}`);
      }
    });
  }, [auth.user, auth.configured, nav]);

  useEffect(() => () => stop(), []);

  const tick = async () => {
    if (!active.current) return;
    try {
      const r = await api.mmEnqueue(tc);
      setRating(r.rating);
      if (!active.current) return;
      if (r.status === 'matched' && r.roomId) {
        stop();
        nav(`/room/${r.roomId}`);
        return;
      }
      if (r.status === 'busy') setMsg(t('ranked.busy'));
      else if (r.status === 'settling') setMsg(t('ranked.settling'));
      else setMsg(null);
    } catch (e) {
      if (alreadyInRoomOf(e)) {
        stop();
        setMsg(errorText(e));
        return;
      }
      setMsg(errorText(e));
    }
    if (active.current) timer.current = window.setTimeout(tick, 4000);
  };

  const startSearch = () => {
    setMsg(null);
    active.current = true;
    setSearching(true);
    setSince(Date.now());
    void tick();
  };

  const cancel = async () => {
    stop();
    try {
      const r = await api.mmCancel();
      if (r.status === 'matched' && r.roomId) nav(`/room/${r.roomId}`); // đã ghép xong trước khi hủy
    } catch (e) {
      setMsg(errorText(e));
    }
  };

  if (!auth.configured) return <NotConfigured />;
  if (!auth.ready) return <Spinner />;
  if (!auth.user) return <Spinner label={t('ranked.creatingGuest')} />;

  const waited = since ? Math.floor((now - since) / 1000) : 0;
  return (
    <div className="page narrow stack">
      <h1>{t('ranked.title')}</h1>
      <p className="muted">
        <Trans i18nKey="ranked.intro" values={{ code: auth.code }} components={{ code: <code />, link: <Link to="/online" /> }} />
      </p>
      {inFriendly && myRoom && (
        <div className="banner" data-testid="ranked-blocked">
          <Trans i18nKey="ranked.blocked" values={{ roomId: myRoom.roomId }} components={{ b: <strong />, link: <Link to={`/room/${myRoom.roomId}`} /> }} />
        </div>
      )}
      {rating !== null && (
        <p>
          <Trans i18nKey="ranked.myRating" values={{ rating }} components={{ b: <strong data-testid="my-rating" /> }} />
        </p>
      )}
      <fieldset className="card" disabled={searching}>
        <legend>{t('ranked.time')}</legend>
        <div className="row" role="radiogroup">
          {TC_OPTIONS.filter((o) => o.ranked).map((o) => (
            <label key={o.id} className={`chip${tc === o.id ? ' checked' : ''}`}>
              <input type="radio" name="tc" value={o.id} checked={tc === o.id} onChange={() => setTc(o.id)} />
              {tcLabel(o.id)}
            </label>
          ))}
        </div>
      </fieldset>
      {searching ? (
        <div className="card highlight stack" role="status" aria-live="polite">
          <p className="searching">
            <span className="spinner" aria-hidden="true" /> {t('ranked.searching', { seconds: waited })}
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={cancel} data-testid="mm-cancel">
              {t('ranked.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn primary big" onClick={startSearch} disabled={inFriendly} data-testid="mm-start">
            {t('ranked.find')}
          </button>
        </div>
      )}
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}
