/**
 * Bảng xếp hạng từ Firestore `leaderboard` (chỉ người đã đủ số trận rated tối thiểu).
 * Thứ tự: rating giảm dần, đồng điểm xếp theo uid (ổn định). Hạng hiển thị = vị trí trong thứ tự đó,
 * chỉ chính xác vì các trang được tải TUẦN TỰ từ đầu bảng.
 * "Hạng của bạn" = 1 + số người có rating CAO HƠN (count aggregation) => đồng điểm cùng hạng.
 */
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, NotConfigured, Spinner } from '../components/common';
import { errorVi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fb } from '../lib/firebase';

const PAGE = 25;
const PLACEMENT = 5;

interface Row {
  uid: string;
  displayName: string;
  photoURL: string | null;
  rating: number;
  ratedGames: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export function LeaderboardPage() {
  const auth = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ rank: number | null; rating: number; ratedGames: number } | null>(null);

  const load = async (after: QueryDocumentSnapshot | null) => {
    const { fs } = fb();
    const base = query(collection(fs, 'leaderboard'), orderBy('rating', 'desc'), orderBy('uid', 'asc'));
    const q = after ? query(base, startAfter(after), limit(PAGE)) : query(base, limit(PAGE));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as Row);
    setRows((r) => (after ? [...(r ?? []), ...list] : list));
    setCursor(snap.docs[snap.docs.length - 1] ?? null);
    setHasMore(snap.docs.length === PAGE);
  };

  useEffect(() => {
    if (!auth.configured || !auth.ready) return;
    (async () => {
      try {
        const u = await auth.ensureSignedIn();
        await load(null);
        {
          const st = await getDoc(doc(fb().fs, 'playerStats', u.uid));
          if (st.exists()) {
            const rating = Number(st.get('rating'));
            const ratedGames = Number(st.get('ratedGames') ?? 0);
            let rank: number | null = null;
            if (ratedGames >= PLACEMENT) {
              const c = await getCountFromServer(query(collection(fb().fs, 'leaderboard'), where('rating', '>', rating)));
              rank = c.data().count + 1;
            }
            setMe({ rank, rating, ratedGames });
          }
        }
      } catch (e) {
        setError(errorVi(e));
      }
    })();
  }, [auth.configured, auth.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!auth.configured) return <NotConfigured />;
  if (error) return <ErrorState message={error} />;
  if (rows === null) return <Spinner label="Đang tải bảng xếp hạng…" />;

  return (
    <div className="page">
      <h1>Bảng xếp hạng</h1>
      <p className="muted small">
        Chỉ tính trận <strong>đấu xếp hạng</strong>; cần tối thiểu {PLACEMENT} trận để lên bảng. Tỉ lệ thắng = số trận thắng ÷ số trận xếp hạng
        (hòa không tính là thắng). Đồng điểm xếp theo mã người chơi.
      </p>
      {me && (
        <div className="card highlight" data-testid="my-rank">
          {me.rank !== null ? (
            <>
              Hạng của bạn: <strong>#{me.rank}</strong> (số người có rating cao hơn + 1) · Rating {me.rating}
            </>
          ) : (
            <>
              Rating {me.rating} · cần thêm {PLACEMENT - me.ratedGames} trận xếp hạng để lên bảng
            </>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title="Chưa có ai trên bảng" message={`Hoàn thành ${PLACEMENT} trận đấu xếp hạng để xuất hiện ở đây.`} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Kỳ thủ</th>
                <th scope="col">Rating</th>
                <th scope="col">Trận</th>
                <th scope="col">T/H/B</th>
                <th scope="col">Tỉ lệ thắng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.uid} className={r.uid === auth.user?.uid ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td>
                    <Link to={`/profile/${r.uid}`} className="player-cell">
                      {r.photoURL ? <img src={r.photoURL} alt="" width={24} height={24} referrerPolicy="no-referrer" /> : <span className="avatar">{r.displayName.slice(0, 1)}</span>}
                      {r.displayName}
                    </Link>
                  </td>
                  <td>
                    <strong>{r.rating}</strong>
                  </td>
                  <td>{r.ratedGames}</td>
                  <td>
                    {r.wins}/{r.draws}/{r.losses}
                  </td>
                  <td>{r.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <button type="button" className="btn" onClick={() => void load(cursor).catch((e) => setError(errorVi(e)))}>
          Tải thêm
        </button>
      )}
    </div>
  );
}
