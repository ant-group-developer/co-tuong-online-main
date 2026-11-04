/**
 * Đấu xếp hạng: server ghép đối thủ theo rating + thời gian. Không chọn đối thủ, không dùng link mời.
 */
import { onValue, ref } from 'firebase/database';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorState, NotConfigured, Spinner, useNow } from '../components/common';
import { api, errorVi, TC_OPTIONS, type Tc } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fb } from '../lib/firebase';

export function RankedPage() {
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

  const stop = () => {
    active.current = false;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setSearching(false);
  };

  // Nghe assignment realtime để vào trận ngay khi được ghép (không phải chờ lượt poll).
  useEffect(() => {
    if (!auth.user || auth.isAnonymous || !auth.configured) return;
    return onValue(ref(fb().db, `mm/assign/${auth.user.uid}`), (s) => {
      const a = s.val() as { roomId?: string } | null;
      if (a?.roomId && active.current) {
        stop();
        nav(`/room/${a.roomId}`);
      }
    });
  }, [auth.user, auth.isAnonymous, auth.configured, nav]);

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
      if (r.status === 'busy') setMsg('Bạn đang có một trận xếp hạng chưa kết thúc.');
      else if (r.status === 'settling') setMsg('Đang cập nhật kết quả trận trước, sẽ tự thử lại…');
      else setMsg(null);
    } catch (e) {
      setMsg(errorVi(e));
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
      setMsg(errorVi(e));
    }
  };

  if (!auth.configured) return <NotConfigured />;
  if (!auth.ready) return <Spinner />;
  if (!auth.user || auth.isAnonymous)
    return (
      <ErrorState
        title="Cần tài khoản để đấu xếp hạng"
        message="Đấu xếp hạng yêu cầu đăng nhập bằng Google hoặc email (không dùng tài khoản khách) để bảo vệ bảng xếp hạng."
        action={
          <Link className="btn primary" to="/login?next=/ranked">
            Đăng nhập
          </Link>
        }
      />
    );

  const waited = since ? Math.floor((now - since) / 1000) : 0;
  return (
    <div className="page narrow">
      <h1>Đấu xếp hạng</h1>
      <p className="muted">
        Hệ thống tự ghép đối thủ có rating gần bạn; khoảng rating mở rộng dần theo thời gian chờ. Muốn chơi với người quen? Dùng{' '}
        <Link to="/online">phòng chơi với bạn</Link> (không tính điểm).
      </p>
      {rating !== null && (
        <p>
          Rating hiện tại: <strong data-testid="my-rating">{rating}</strong>
        </p>
      )}
      <fieldset className="card" disabled={searching}>
        <legend>Thời gian</legend>
        <div className="row" role="radiogroup">
          {TC_OPTIONS.filter((t) => t.ranked).map((t) => (
            <label key={t.id} className={`chip${tc === t.id ? ' checked' : ''}`}>
              <input type="radio" name="tc" value={t.id} checked={tc === t.id} onChange={() => setTc(t.id)} />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      {searching ? (
        <div className="card highlight" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Đang tìm đối thủ… {waited}s
          <div className="row">
            <button type="button" className="btn" onClick={cancel} data-testid="mm-cancel">
              Hủy tìm
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn primary big" onClick={startSearch} data-testid="mm-start">
          Tìm trận
        </button>
      )}
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}
