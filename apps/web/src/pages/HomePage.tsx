import { START_FEN, positionFromFen } from '@xq/engine';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Board } from '../components/Board';
import { APP_NAME } from '../components/Layout';

export function HomePage() {
  const board = useMemo(() => positionFromFen(START_FEN).board, []);
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <img src="/logo.png" alt="" width={72} height={72} className="hero-logo" />
          <h1>{APP_NAME}</h1>
          <p>Cờ tướng cho người Việt: đấu máy 6 mức độ, đấu xếp hạng, chơi với bạn bè và xem trận trực tiếp.</p>
          <div className="hero-actions">
            <Link to="/ai" className="btn primary big" data-testid="home-ai">
              Chơi với máy
            </Link>
            <Link to="/ranked" className="btn big">
              Đấu xếp hạng
            </Link>
            <Link to="/online" className="btn big">
              Chơi với bạn
            </Link>
          </div>
          <ul className="feature-list">
            <li>
              <strong>6 mức AI</strong> – từ Siêu dễ tới Bậc thầy, chạy ngay trên trình duyệt, không cần mạng.
            </li>
            <li>
              <strong>Online thời gian thực</strong> – nước đi và đồng hồ do máy chủ xác thực.
            </li>
            <li>
              <strong>Phòng công khai / riêng tư</strong> – link mời chơi hoặc mời xem tách quyền.
            </li>
            <li>
              <Link to="/leaderboard">Bảng xếp hạng</Link> và <Link to="/profile">thống kê cá nhân</Link>.
            </li>
          </ul>
        </div>
        <div className="hero-board" aria-hidden="true">
          <Board board={board} disabled ariaLabel="Bàn cờ minh họa" />
        </div>
      </section>
    </div>
  );
}

export function RulesPage() {
  return (
    <div className="page narrow prose">
      <h1>Luật & chính sách</h1>
      <h2>Luật cờ (phiên bản xq-rules-v1)</h2>
      <p>Đây là bộ luật giản lược, chưa phải luật thi đấu Á châu đầy đủ:</p>
      <ul>
        <li>Đi đúng luật từng quân; hai tướng không được đối mặt; không được để tướng mình bị chiếu.</li>
        <li>Bên đến lượt không còn nước đi hợp lệ (bị chiếu hết hoặc hết nước) là thua.</li>
        <li>
          Vị trí lặp lại lần thứ 3: nếu trong chu kỳ lặp mọi nước của đúng một bên đều là nước chiếu, bên đó thua (trường chiếu); ngược lại hòa.
          Trường tróc chưa được phân xử riêng (tính là hòa lặp).
        </li>
        <li>60 nước mỗi bên (120 nửa nước) không ăn quân: hòa. Cả hai bên không còn xe/mã/pháo/tốt: hòa. Giới hạn 300 nước mỗi bên.</li>
      </ul>
      <h2>Online</h2>
      <ul>
        <li>Đồng hồ do máy chủ tính (giờ UTC). Hai nước đầu không trừ giờ; mỗi bên có 30 giây để đi nước đầu, quá hạn trận bị hủy và không tính.</li>
        <li>Hết giờ là thua, trừ khi đối phương không còn quân tấn công (hòa). Có ân hạn mạng cố định 0,25 giây.</li>
        <li>Mất kết nối không bị xử thua ngay; đồng hồ vẫn chạy. Sau 60 giây mất kết nối liên tục, đối thủ có thể yêu cầu xử thắng.</li>
        <li>Đấu xếp hạng: Elo (khởi điểm 1200, K=40 cho 10 trận đầu, sau đó K=32). Cần 5 trận để lên bảng xếp hạng. Phòng bạn bè không tính điểm.</li>
        <li>Đi lại chỉ có ở phòng bạn bè và cần đối thủ đồng ý.</li>
      </ul>
    </div>
  );
}
