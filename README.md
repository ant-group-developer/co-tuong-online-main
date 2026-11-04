# Cờ Tướng Online (Firebase)

Game cờ tướng web cho người Việt, dùng được trên desktop và mobile:
- **Chơi với máy**: 6 mức (Siêu dễ, Dễ, Trung bình, Khó, Siêu khó, Bậc thầy). Chạy offline trong trình duyệt.
- **Online 1vs1**: Đấu xếp hạng (server ghép đối thủ, có Elo) và Chơi với bạn (phòng Công khai/Riêng tư, link mời chơi/mời xem).
- **Sảnh phòng công khai**, xem trận trực tiếp (chỉ đọc), bảng xếp hạng, hồ sơ, lịch sử trận và xem lại.

Nước đi, đồng hồ và kết quả đều do **Cloud Functions** xác thực. Trạng thái trận live nằm trên **Realtime Database**.
Thống kê, rating, bảng xếp hạng và bản lưu trận nằm trên **Firestore**.

## Bắt đầu nhanh

```powershell
npm install
npm --prefix functions install

# Chỉ chơi với máy (không cần Firebase):
npm run dev                     # http://localhost:5173/ai

# Chạy đầy đủ online bằng Emulator (cần Java 21; repo dùng JDK portable trong .tools/ nếu có)
npm --prefix functions run build
npm run emulators               # terminal 1
npm run dev:emu                 # terminal 2 → http://localhost:5173
```

Cấu hình project Firebase thật và deploy: xem **[docs/HUONG-DAN-CAU-HINH-FIREBASE.md](docs/HUONG-DAN-CAU-HINH-FIREBASE.md)**.

### Chạy bằng Docker

```powershell
# Cấu hình ở file .env (thư mục gốc; mẫu: .env.example)
docker compose up -d --build        # → http://localhost:3000
```

Chi tiết: **[docs/DOCKER.md](docs/DOCKER.md)**.

### Nhúng vào trang khác (iframe)

Mọi trang đều được nhúng (`Content-Security-Policy: frame-ancestors *`, cấu hình ở `firebase.json` và `docker/web/nginx.conf`):

```html
<iframe src="https://co-tuong-online-81005.web.app/ai" width="420" height="860"
        style="border:0;max-width:100%" allow="fullscreen; autoplay"></iframe>
```

Đường dẫn trực tiếp: `/ai` (chơi với máy), `/online` (sảnh phòng), `/room/<mã>` (vào/xem phòng), `/leaderboard`.
Nếu trang chủ dùng `sandbox`, cần thêm `allow-scripts allow-same-origin allow-popups allow-forms`, nếu không đăng nhập Google (popup) sẽ không chạy.
Một số trình duyệt chặn cookie bên thứ ba (Safari, Chrome ở chế độ chặn) có thể không cho đăng nhập Google bên trong iframe.
Chơi với máy và chơi bằng tài khoản khách không bị ảnh hưởng.
Muốn giới hạn lại chỉ vài domain: đổi `frame-ancestors *` thành `frame-ancestors https://domain-cua-ban.com`.

## Tài liệu

- [Hướng dẫn cấu hình Firebase & deploy](docs/HUONG-DAN-CAU-HINH-FIREBASE.md)
- [Chạy bằng Docker](docs/DOCKER.md)
- [Kiến trúc, mô hình dữ liệu, luật, đồng bộ, bảo mật](docs/KIEN-TRUC.md)
- [AI: thiết kế 6 mức + kết quả benchmark](docs/AI-BENCHMARK.md)
- Ảnh so sánh với bản tham chiếu: `docs/screenshots/`

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm test` | Test luật + AI + lõi server (không cần emulator) |
| `npm run test:rules` | Test Security Rules (emulator) |
| `npm run test:integration` | Test Functions/RTDB/Firestore qua emulator |
| `npm run test:e2e` | Playwright: 2 người chơi + khán giả + AI mobile |
| `npm run bench:ai` | Benchmark AI (tactical suite + đấu chéo) |
| `npm run build` | Build web + bundle functions |
| `npm run typecheck` | Kiểm tra kiểu toàn repo |

## Cấu trúc

```
packages/engine   luật cờ + AI (TypeScript thuần, dùng chung web/worker/server)
apps/web          React + Vite (logo: public/logo.png, logo ở sông: public/river-logo.jpg)
functions         Cloud Functions v2 (asia-southeast1)
tests/, e2e/      unit, rules, integration, E2E
docs/             tài liệu
```

## Trạng thái

- Đã kiểm thử trên Emulator Suite (xem `docs/KIEN-TRUC.md` §7).
- **Đã deploy** ngày 04/11/2026 lên project `co-tuong-online-81005`: <https://co-tuong-online-81005.web.app>
  (Rules RTDB + Firestore, index, 20 Cloud Functions ở asia-southeast1, Hosting). Smoke test trên bản thật: đăng nhập khách,
  tạo/rời phòng qua Functions, đọc phòng, client ghi phòng/rating bị chặn. Chưa chạy E2E Playwright trên bản thật.
- Luật là bản giản lược `xq-rules-v1` (chưa phân xử trường tróc).
- Bàn và quân vẽ bằng SVG/CSS riêng. Không dùng ảnh, âm thanh hay thương hiệu của XQChess.
