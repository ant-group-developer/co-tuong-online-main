# Hướng dẫn cấu hình Firebase cho Cờ Tướng Online

Tài liệu này hướng dẫn từng bước, từ tạo project trên Firebase Console tới deploy game lên mạng.
Ngày viết: 04/11/2026. Giao diện Console có thể đổi chỗ nút theo thời gian, nhưng các bước cơ bản giữ nguyên.

---

## 0. Hiểu nhanh: Console làm gì, code làm gì?

| Việc | Làm ở đâu |
|---|---|
| Tạo project, bật đăng nhập, tạo database, lấy **key web** | Firebase Console (trình duyệt) |
| Dán key vào file `.env` ở thư mục gốc | Máy bạn |
| **Luật bảo mật** (ai được đọc/ghi gì) | File `database.rules.json`, `firestore.rules` → deploy bằng CLI |
| **Code server**: kiểm tra nước đi, đồng hồ, ghép trận, tính Elo | Thư mục `functions/` → deploy lên Cloud Functions |
| **Trang web** | Thư mục `apps/web/` → build rồi deploy lên Firebase Hosting |

Key web (apiKey, projectId…) **không phải bí mật**. Nó chỉ cho trình duyệt biết kết nối tới project nào.
Thứ bảo vệ dữ liệu là Security Rules và Cloud Functions, nên **bắt buộc phải deploy** chúng.
Không bao giờ đưa *service account key* (file JSON `...-adminsdk-...json`) vào web hoặc repo.

---

## 1. Chuẩn bị trên máy

- **Node.js 22 trở lên** (đã kiểm tra với Node 24): <https://nodejs.org>
- **Java 21 trở lên**: chỉ cần khi chạy **Emulator** local. Không cần cho deploy.
  - Nếu chưa cài Java: tải JDK dạng zip (ví dụ Temurin 21 từ <https://adoptium.net>) rồi giải nén vào `xiangqi-firebase/.tools/`.
    Script `scripts/with-java.mjs` sẽ tự tìm thư mục `.tools/jdk-*`. Bản trên máy bạn đã có sẵn `.tools/jdk-21.0.13+9`.
- Cài thư viện (chạy trong thư mục `xiangqi-firebase`):

```powershell
npm install
npm --prefix functions install
```

Firebase CLI đã nằm trong `devDependencies`, gọi bằng `npx firebase ...`, không cần cài global.

---

## 2. Tạo project Firebase

1. Mở <https://console.firebase.google.com> → **Create a project** (Tạo dự án).
2. Đặt tên, ví dụ `co-tuong-online`. Ghi lại **Project ID**, ví dụ `co-tuong-online-12ab3`.
3. Google Analytics: **không bắt buộc**. Game không dùng Analytics, có thể tắt.

## 3. Nâng cấp gói Blaze (bắt buộc)

Cloud Functions (thế hệ 2), Cloud Tasks và Cloud Scheduler **chỉ chạy trên gói Blaze** (trả theo mức dùng).

1. Góc dưới bên trái Console → **Upgrade** → chọn **Blaze** → liên kết tài khoản thanh toán Google Cloud.
2. **Nên đặt cảnh báo ngân sách**: Google Cloud Console → Billing → Budgets & alerts → tạo budget, ví dụ 5–10 USD/tháng, kèm email cảnh báo.

> Blaze có hạn mức miễn phí cho nhiều dịch vụ, nhưng **không có cam kết miễn phí**. Chi phí phụ thuộc số trận và số người.
> Xem mục 12 để biết thành phần nào phát sinh chi phí.

## 4. Bật Authentication (đăng nhập)

Console → **Build → Authentication → Get started** → tab **Sign-in method**, bật 3 phương thức:

| Phương thức | Dùng cho |
|---|---|
| **Google** | Đăng nhập nhanh. Cần chọn *Project support email*. |
| **Email/Password** | Đăng ký bằng email (chỉ bật dòng đầu, *không cần* "Email link"). |
| **Anonymous** | **Bắt buộc.** Mỗi trình duyệt tự có tài khoản khách (ID 6 ký tự) để chơi phòng bạn bè, đấu xếp hạng, xem trận. |

Tab **Settings → Authorized domains**: `localhost` và `<project>.web.app` có sẵn.
Nếu dùng tên miền riêng (ví dụ `cotuong.ant-media.net`), **thêm tên miền đó vào đây**, nếu không đăng nhập Google sẽ báo lỗi.

## 5. Tạo Realtime Database (trạng thái trận đấu live)

1. Console → **Build → Realtime Database → Create Database**.
2. **Location: Singapore (asia-southeast1)**. Đây là vùng gần Việt Nam và **trùng vùng Cloud Functions trong code**.
3. Chọn **Start in locked mode**. Rules thật sẽ được deploy từ file `database.rules.json`.
4. Sau khi tạo, copy URL ở đầu trang, có dạng:
   `https://<project-id>-default-rtdb.asia-southeast1.firebasedatabase.app`

> Nếu bạn lỡ tạo RTDB ở vùng khác (ví dụ `us-central1`), tạo file `functions/.env` với dòng `RTDB_REGION=us-central1`.
> Trigger của Functions **phải cùng vùng với database**, nếu không sẽ không chạy.

## 6. Tạo Cloud Firestore (hồ sơ, thống kê, bảng xếp hạng, lịch sử)

1. Console → **Build → Firestore Database → Create database**.
2. Edition: **Standard**. Mode: **Native**.
3. **Location: `asia-southeast1` (Singapore)**. Vùng Firestore **không đổi được** sau khi tạo.
4. Chọn **Start in production mode** (rules thật sẽ deploy từ `firestore.rules`).

## 7. Đăng ký Web App và lấy key → `.env`

1. Console → biểu tượng ⚙️ **Project settings → General** → kéo xuống **Your apps** → nút **`</>` (Web)**.
2. Đặt tên app, ví dụ `web`. Có thể bỏ chọn ô "Also set up Firebase Hosting", lát nữa sẽ cấu hình bằng CLI.
3. Console hiện đoạn `const firebaseConfig = { ... }`. Copy các giá trị sang file **`.env` ở thư mục gốc** `xiangqi-firebase/.env`,
   cạnh `firebase.json` (tạo bằng cách sao chép `.env.example`). Đây là file env **duy nhất** của web: dùng cho
   `npm run dev`, `npm run build` / deploy Hosting và Docker:

```dotenv
VITE_APP_NAME=Cờ Tướng Online

VITE_FIREBASE_API_KEY=AIza...                      # firebaseConfig.apiKey
VITE_FIREBASE_AUTH_DOMAIN=co-tuong-online-12ab3.firebaseapp.com   # authDomain
VITE_FIREBASE_PROJECT_ID=co-tuong-online-12ab3     # projectId
VITE_FIREBASE_DATABASE_URL=https://co-tuong-online-12ab3-default-rtdb.asia-southeast1.firebasedatabase.app  # databaseURL (copy ở bước 5)
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef...    # appId
VITE_FIREBASE_STORAGE_BUCKET=co-tuong-online-12ab3.firebasestorage.app   # (không bắt buộc)
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890        # (không bắt buộc)

VITE_FUNCTIONS_REGION=asia-southeast1
VITE_USE_EMULATORS=false
VITE_APPCHECK_RECAPTCHA_ENTERPRISE_KEY=             # để trống nếu chưa dùng App Check (mục 10)
```

> Nếu `firebaseConfig` không có `databaseURL` (do RTDB được tạo sau khi đăng ký app), lấy URL ở bước 5.
> `.env` đã nằm trong `.gitignore`. Thư mục `apps/web` **không** cần file env nào.

## 8. Kết nối Firebase CLI với project

```powershell
npx firebase login                 # mở trình duyệt để đăng nhập Google
npx firebase use --add             # chọn project vừa tạo, đặt alias: default
```

Lệnh trên sửa `.firebaserc`. Bạn cũng có thể sửa tay:

```json
{ "projects": { "default": "co-tuong-online-12ab3" } }
```

## 9. Deploy

Chạy trong thư mục `xiangqi-firebase`:

```powershell
npm run build                      # build web (apps/web/dist) + bundle functions (functions/lib)
npx firebase deploy
```

Hoặc deploy từng phần (nên làm theo thứ tự này ở lần đầu):

```powershell
npx firebase deploy --only database                       # Rules Realtime Database
npx firebase deploy --only firestore:rules,firestore:indexes
npx firebase deploy --only functions                      # lần đầu mất 5–10 phút
npx firebase deploy --only hosting
```

Những gì sẽ xảy ra ở lần deploy Functions đầu tiên:
- CLI tự **bật các API** cần thiết: Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, Eventarc, Pub/Sub,
  Cloud Scheduler, Cloud Tasks. Nếu báo lỗi kiểu "API has not been used / is disabled", đợi 1–2 phút rồi deploy lại.
- Tạo 20 function ở vùng `asia-southeast1`:
  - **callable**: `createRoom`, `joinRoom`, `leaveRoom`, `setReady`, `updateRoomSettings`, `kickGuest`, `requestRematch`,
    `createInvite`, `revokeInvite`, `redeemInvite`, `submitMove`, `matchAction`, `mmEnqueue`, `mmCancel`
  - **trigger RTDB**: `onMatchOutbox` (ghi kết quả vào Firestore), `onRoomViewer` (đếm người xem)
  - **task queue**: `clockTimeout` (xử thua khi hết giờ, kể cả khi cả hai người đã đóng trình duyệt)
  - **lịch**: `sweepDeadlines` (mỗi phút), `reconcileResults` (mỗi 5 phút), `dailyCleanup` (04:00 hằng ngày)
- Index Firestore cần vài phút để build. Trong lúc đó trang Bảng xếp hạng có thể báo lỗi "requires an index".

Sau khi xong, web chạy tại `https://<project-id>.web.app`.

### Nếu hẹn giờ hết giờ (Cloud Tasks) báo lỗi quyền

Nếu log Functions có `PERMISSION_DENIED` khi enqueue `clockTimeout`, vào Google Cloud Console → **IAM** và cấp cho
service account mặc định của Functions (`<project-number>-compute@developer.gserviceaccount.com`) hai vai trò:
**Cloud Tasks Enqueuer** và **Service Account User**.
Trong lúc chưa sửa, game vẫn kết thúc đúng khi hết giờ nhờ `sweepDeadlines` (trễ tối đa ~1 phút) và client tự yêu cầu xử.

## 10. App Check (tùy chọn, nên bật khi chạy thật)

App Check giúp chặn bot và script gọi thẳng API. Nó **bổ sung**, không thay thế đăng nhập hay luật game.

1. Google Cloud Console → **reCAPTCHA Enterprise** → tạo key loại *Website*, thêm tên miền của bạn.
2. Firebase Console → **Build → App Check** → app Web → chọn **reCAPTCHA Enterprise** → dán site key.
3. Điền `VITE_APPCHECK_RECAPTCHA_ENTERPRISE_KEY=<site key>` vào `.env` (thư mục gốc), build và deploy lại hosting.
4. Theo dõi tab App Check vài ngày, thấy request hợp lệ rồi mới bật bắt buộc:
   - Tạo `functions/.env` có dòng `ENFORCE_APP_CHECK=true`, rồi `npx firebase deploy --only functions`.
   - Trong tab App Check, bấm **Enforce** cho Realtime Database và Cloud Firestore.

## 11. Kiểm tra sau khi deploy

- [ ] Mở `https://<project-id>.web.app` → **Chơi với máy** chạy được (chế độ này không cần mạng).
- [ ] Đăng nhập Google và Email đều được.
- [ ] Mở 2 trình duyệt (một cửa sổ ẩn danh): A tạo phòng → B vào ghế → hai bên **Sẵn sàng** → đi vài nước.
- [ ] Cửa sổ thứ 3 mở link phòng: thấy "Bạn đang xem (chỉ đọc)", số người xem tăng.
- [ ] Tạo phòng **Riêng tư**: người không có lời mời thấy "Phòng riêng tư"; lời mời XEM không cho vào ghế.
- [ ] Đầu hàng → vài giây sau Hồ sơ hiện 1 trận giao hữu.
- [ ] Hai trình duyệt (khách hoặc đã đăng nhập) cùng bấm **Đấu xếp hạng** cùng thời gian → được ghép. Xong trận, rating đổi (1200 → 1220/1180).
- [ ] Console → Functions → **Logs** không có lỗi đỏ lặp lại.

## 12. Chi phí & quota (tham khảo, không cam kết)

| Thành phần | Phát sinh khi | Ghi chú |
|---|---|---|
| Cloud Functions | Mỗi nước đi = 1 lần gọi `submitMove`; mỗi trận ~100–200 lần gọi | Có hạn mức miễn phí theo tháng (xem trang giá) |
| Realtime Database | Dữ liệu tải về khi người chơi/khán giả theo dõi bàn | Tính theo GB tải về và GB lưu trữ |
| Firestore | ~8–10 lượt ghi mỗi trận kết thúc, đọc khi xem bảng xếp hạng/hồ sơ | Có hạn mức đọc/ghi miễn phí mỗi ngày |
| Cloud Tasks | 1 task cho mỗi nước đi (hẹn giờ deadline) | Hạn mức miễn phí khá lớn mỗi tháng |
| Cloud Scheduler | 3 job (`sweepDeadlines`, `reconcileResults`, `dailyCleanup`) | Mỗi tài khoản billing có vài job miễn phí |
| Hosting | Lưu trữ + băng thông tải web (~1 MB/lần tải đầu) | Có hạn mức miễn phí |

Bảng giá chính thức: <https://firebase.google.com/pricing>. Hãy luôn đặt **budget alert** (mục 3).

## 13. Chạy thử trên máy bằng Emulator (không cần project thật)

```powershell
# Terminal 1: chạy Auth + RTDB + Firestore + Functions + Tasks giả lập (project demo-xiangqi)
npm --prefix functions run build
npm run emulators

# Terminal 2: web ở chế độ emulator
npm run dev:emu
```

- Mở web: <http://localhost:5173>. Giao diện quản lý emulator: <http://localhost:4000>.
- Port dùng: Auth 9099, RTDB 9000, Firestore **8085** (máy này có tiến trình khác chiếm 8080), Functions 5001, Tasks 9499.
- Emulator không chạy job theo lịch và **không tôn trọng giờ hẹn của Cloud Tasks**. Vì vậy ở local, hết giờ được xử khi client gửi
  `claimTimeout` (trình duyệt tự gửi khi đồng hồ đối thủ về 0).

Bộ test:

```powershell
npm test                  # luật cờ + AI + lõi server (không cần emulator)
npm run test:rules        # Security Rules (cần Java)
npm run test:integration  # Functions + RTDB + Firestore qua emulator
npm run test:e2e          # Playwright: 2 người chơi + 1 khán giả, dùng Chrome đã cài
npm run bench:ai          # benchmark 6 mức AI (~20–40 phút)
```

## 14. Lỗi thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Web hiện "Chế độ online chưa được cấu hình" | Thiếu `VITE_FIREBASE_API_KEY` / `PROJECT_ID` / `DATABASE_URL` trong `.env` ở thư mục gốc. Sửa xong phải **build lại** (Hosting) hoặc `docker compose up -d` (Docker) |
| `auth/operation-not-allowed` | Chưa bật phương thức đăng nhập đó (mục 4) |
| `auth/unauthorized-domain` | Thêm tên miền vào Authorized domains (mục 4) |
| Gọi function báo `internal` / CORS | Function chưa deploy, hoặc `VITE_FUNCTIONS_REGION` khác `asia-southeast1` |
| Bảng xếp hạng báo "requires an index" | Chưa deploy `firestore:indexes` hoặc index đang build (chờ vài phút) |
| Đánh xong mà Hồ sơ không có trận | Trigger `onMatchOutbox` không chạy: kiểm tra RTDB có ở **asia-southeast1** không (hoặc đặt `RTDB_REGION`), xem log Functions |
| `PERMISSION_DENIED` khi đọc phòng | Đúng thiết kế nếu là phòng riêng tư mà bạn chưa có lời mời. Nếu phòng công khai: rules RTDB chưa deploy |
| Deploy functions lỗi "Billing account not configured" | Chưa nâng Blaze (mục 3) |
| Deploy báo `Pass the --force option to deploy functions with a failure policy` | `onMatchOutbox` có tự thử lại (đã idempotent). Chạy `npx firebase deploy --only functions --force` |
| Cloud Build lỗi `npm ci can only install packages when your package.json and package-lock.json ... are in sync` | Chạy `npm --prefix functions install` để cập nhật `functions/package-lock.json`, rồi deploy lại |
| `Upload Error: Failed to make request to https://storage.googleapis.com/...` | Thường gặp ngay sau khi CLI vừa bật API. Đợi 1–2 phút rồi deploy lại |
| Gọi callable bị **401/403 từ Google Frontend** (body không phải JSON `{"error":...}`) | Cloud Run chưa cho `allUsers` gọi. CLI chỉ cấp quyền này khi **tạo** function; nếu lần tạo đầu bị lỗi giữa chừng thì quyền bị thiếu. Cách sửa: `npx firebase functions:delete <tên các callable> --region asia-southeast1 --force` rồi deploy lại (hoặc thêm principal `allUsers`, vai trò *Cloud Run Invoker* cho từng service trong Cloud Run). Quyền mới cần ~1 phút để có hiệu lực |

## 15. Ghi chú bảo mật

- Client **không thể** tự ghi bàn cờ, kết quả, rating, thống kê. Rules chặn, và việc này đã có test (`tests/rules`).
- Token mời phòng riêng tư dài 256-bit. Server chỉ lưu **hash SHA-256**, có hạn 24 giờ, chủ phòng thu hồi được.
- Admin SDK chỉ chạy trong Cloud Functions. Không tạo hay tải service account key cho game này.
