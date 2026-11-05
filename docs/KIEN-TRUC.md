# Kiến trúc, mô hình dữ liệu và chính sách

## 1. Nghiên cứu bản tham chiếu (`../xqchess-clone`)

Tôi đã đọc trực tiếp mã để kiểm chứng các phát hiện trong `research/NGHIEN-CUU-SOURCE.md`. Phiên làm việc này **không có REA MCP**,
nên không có Evidence ID mới. Số dòng bên dưới là của `public/js/jxq.js` tại thời điểm đọc.

| Phát hiện | Kiểm chứng | Xử lý trong bản mới |
|---|---|---|
| `Logic.getDefault` (649) dựng bàn 10×9, quân `{type,color,opened}` | Đúng | Dùng mảng 90 ô có dấu (Đỏ dương, Đen âm), FEN chuẩn |
| `isValidMove` (732): cản mã, mắt tượng, ngòi pháo, cung, sông | Đúng. Phụ thuộc cờ `rotated` | Luật dựng lại bằng bảng tiền tính toán, kiểm bằng perft + 37 test |
| `isValidGeneralStateAfterMove` (929): tướng đối mặt + tự chiếu | Đúng | `Position.isAttacked` gộp luật tướng đối mặt vào kiểm tra bị tấn công |
| `_handleEvents` (~1276–1283): bắt exception rồi `ok = true` | **Đúng: có lỗi** | `Game.play`: mọi exception ⇒ từ chối nước. Có test input sai |
| `rotate()` (972) đổi ma trận bàn | Đúng | Tọa độ canonical cố định; lật bàn chỉ ở `view.ts` (test hash không đổi) |
| `getAiMove` (984): shuffle danh sách nước hợp lệ | Đúng (bot ngẫu nhiên) | Engine tìm kiếm mới, 6 profile, có benchmark |
| `site.css` (~458): khung 414:460, ô 46 | Đúng | Bàn SVG cùng tỷ lệ, quân 11,11% × 10% quanh giao điểm |
| Ảnh `board.png` có chữ "XQchess" ở sông | Đúng | Không dùng ảnh/brand gốc. Bàn và quân vẽ bằng SVG/CSS, sông đặt logo ANT GROUP |
| `game.js` dùng SignalR `/gameHub` | Đúng, không có backend | Không kết nối. Backend mới là Firebase |

Âm thanh dùng WebAudio tổng hợp, không lấy file `.mp3` của bản tham chiếu. Màu sắc chỉ lấy *cảm hứng* từ token trong `xq-app.css`.

## 2. Thành phần

```
packages/engine   TypeScript thuần: luật (Position/Game/FEN/notation/view) + AI (search/evaluate/profiles)
apps/web          React 19 + Vite 8; AI chạy trong Web Worker; Firebase JS SDK 13
functions         Cloud Functions v2 (Node 24, asia-southeast1); esbuild nhúng engine vào lib/index.js
database.rules.json / firestore.rules / firestore.indexes.json
tests/unit        Lõi server (thuần) – không cần emulator
tests/rules       Security Rules (emulator)
tests/integration Callable + trigger + rules end-to-end (emulator)
e2e               Playwright: 2 người chơi + 1 khán giả, AI trên mobile
```

Nguyên tắc:
- **Một nguồn sự thật cho trận live: RTDB** (`rooms/{roomId}/matches/{matchId}`). Chỉ Cloud Functions được ghi.
- Lõi xử lý (`functions/src/core/*`) là **hàm thuần** chạy trong callback transaction. Callback có thể chạy lại nên không được có side effect.
  Side effect (hẹn giờ, chỉ mục lobby, trạng thái phòng) chạy **sau commit**.

## 3. Luật (RULES_VERSION `xq-rules-v1`)

Định nghĩa ở `packages/engine/src/game.ts`:
1. Hết nước hợp lệ (bị chiếu hết hoặc không) ⇒ thua.
2. Lặp vị trí lần 3 (cùng bên đi, kể từ lần ăn quân gần nhất): nếu chỉ một bên chiếu ở **mọi** nước của mình trong chu kỳ ⇒ bên đó thua (trường chiếu). Các trường hợp khác ⇒ hòa. **Trường tróc chưa phân xử.**
3. 120 nửa nước không ăn quân ⇒ hòa (chiếu hết ở nước cuối được ưu tiên).
4. Không bên nào còn xe/mã/pháo/tốt ⇒ hòa.
5. 600 nửa nước ⇒ hòa (chặn ván kéo dài vô hạn).

Đây là luật giản lược, **không phải** luật giải đấu Á châu đầy đủ.

## 4. Realtime Database

| Đường dẫn | Nội dung | Ghi | Đọc |
|---|---|---|---|
| `rooms/{roomId}/meta` | ownerUid, ownerName(≤24), mode, visibility, status, tc, ownerColor, matchId, matchCount, rematch{uid:true}, createdAt, updatedAt | Functions | public: mọi user đã auth; private: chỉ `members` |
| `rooms/{roomId}/seats/{host,guest}` | uid, name, ready, rating | Functions | như trên |
| `rooms/{roomId}/members/{uid}` | role (player/spectator), at. ≤50 người | Functions (redeem invite/join) | như trên |
| `rooms/{roomId}/matches/{matchId}` | players{red,black}, mode, rated, visibility, rulesVersion, createdAt, **state**, **cmds**, **outbox** | Functions (transaction) | như trên |
| `…/state` | v, status, startFen, moves (chuỗi ICCS, ≤600 nước ≈ 3 KB), fen, ply, turn, lastMove, inCheck, clock{red,black,turnStartedAt,incrementMs}, deadline, drawOffer, undoRequest, result{winner,reason,endedAt}, hash | | |
| `…/cmds/{commandId}` | uid, ok, code, v, at. Giữ 40 lệnh gần nhất (idempotency) | | |
| `…/outbox` | status pending/done, createdAt, processedAt | | |
| `publicRooms/{roomId}` | Chỉ mục **dẫn xuất** cho sảnh: không có members/token/email | Functions | mọi user đã auth |
| `roomViewers/{roomId}/{uid}/{connId}` | {at} theo từng kết nối, `onDisconnect().remove()` | chính UID đó, phòng đọc được | không ai |
| `roomLastSeen/{roomId}/{uid}` | thời điểm server lúc mất kết nối | chính UID đó | không ai |
| `roomStats/{roomId}` | spectators (đếm theo UID, không tính người chơi), playersOnline | Functions (trigger) | như quyền đọc phòng |
| `presence/{uid}/{connId}` | {at} | chính UID đó | user đã auth |
| `userRooms/{uid}` | roomId, mode, at: phòng mà người đó đang **ngồi ghế** (waiting/ready/playing). Chỉ mục dẫn xuất, ghi sau mỗi commit phòng | Functions | chính UID đó |
| `roomEmotes/{roomId}/{uid}` | e (wave/happy/thinking), at: biểu cảm vừa gửi trên bàn 3D | chính người đang ngồi ghế (≥1,5 giây/lần) | ai xem được phòng |
| `mm/queue/{uid}`, `mm/assign/{uid}`, `mm/active/{uid}` | hàng chờ, kết quả ghép, lease rated | Functions | chỉ `assign` của chính mình |
| `invites/{sha256}` | roomId, role, expiresAt, revoked (chỉ lưu **hash** của token) | Functions | không ai |
| `roomInvites/{roomId}/{inviteId}` | role, expiresAt, revoked | Functions | chủ phòng |
| `deadlines/{matchId}`, `pendingResults/{matchId}` | chỉ mục cho sweep/đối soát | Functions | không ai |
| `rateLimits/{uid}/{action}` | timestamp gần đây | Functions | không ai |

Không có `.read` ở cấp cha của `rooms`: không ai liệt kê được toàn bộ phòng, và biết `roomId` của phòng private cũng không đọc được.
Index: `rooms` theo `meta/updatedAt`; `publicRooms` theo `updatedAt`, `status`; `deadlines`, `pendingResults` theo `at`; `invites` theo `expiresAt`.

**Điểm nóng transaction**: mỗi nước đi chỉ transaction trên một trận (vài KB). Người xem và presence nằm ở nhánh khác, không chạm vào trận.
Ghép trận dùng transaction trên node `mm`, nên tuần tự hóa mọi thao tác ghép. Cách này đủ cho quy mô nhỏ–vừa; khi đông người cần shard theo time control.

**Lưu giữ**: `dailyCleanup` xóa phòng đã xong/hủy quá 24 giờ (khi outbox đã done) và lời mời hết hạn. Lịch sử lâu dài nằm ở Firestore.

## 5. Firestore

| Collection | Field chính | Ghi | Đọc |
|---|---|---|---|
| `publicProfiles/{uid}` | displayName (2–24, không `<>`), photoURL (https), **code** (ID người chơi = 6 ký tự đầu UID viết hoa, rules kiểm tra khớp UID), **isGuest** (rules kiểm tra khớp loại đăng nhập), **avatar** (nhân vật 3D, 1 trong 9 giá trị), createdAt, updatedAt | **chính chủ** (rules validate schema) | user đã auth |
| `playerStats/{uid}` | rating, peakRating, ratedGames, wins, losses, draws, friendly*, ratingVersion, lastRatedMatchId | Functions | user đã auth |
| `leaderboard/{uid}` | uid, displayName, photoURL, rating, ratedGames, wins, losses, draws, winRate | Functions (chỉ khi ≥5 trận rated) | user đã auth |
| `matches/{matchId}` | players + rating trước/sau, winner, reason, startFen, moves[], finalHash, finalVersion, rulesVersion, visibility, playerUids | Functions | public: user đã auth; private: 2 người chơi; chỉ `get` |
| `players/{uid}/history/{matchId}` | tóm tắt cho hồ sơ | Functions | chủ sở hữu: tất cả; người khác: `visibility=='public'` |
| `ratingLedger/{matchId}` | khóa chống áp dụng 2 lần + delta | Functions | không ai |

Index ghép: `leaderboard (rating desc, uid asc)`, `history (visibility asc, endedAt desc)`.

## 6. Luồng chính

**Tài khoản khách**: lần đầu vào web, trình duyệt tự đăng nhập Firebase Anonymous và tạo `publicProfiles` với tên "Khách <ID>".
Khách đổi tên được, có hồ sơ, chơi phòng bạn bè **và đấu xếp hạng**. Đăng nhập Google/tạo tài khoản email từ tài khoản khách dùng
`linkWithPopup`/`linkWithCredential`: UID giữ nguyên nên ID, rating, lịch sử được giữ. Đăng nhập vào tài khoản đã tồn tại thì chuyển sang
tài khoản đó (dữ liệu khách ở lại UID cũ). Trang `/profile` có 2 tab: Hồ sơ + Đăng nhập (khách) / Tài khoản (đã đăng nhập); `/login` chuyển về tab đăng nhập.

**Một người – một phòng**: `createRoom`, `joinRoom` (vào ghế) và `mmEnqueue` gọi `assertNotInOtherRoom`: nếu `userRooms/{uid}` trỏ tới phòng còn
hoạt động mà người đó đang ngồi ghế ⇒ lỗi `failed-precondition` kèm `details {code: "already_in_room", roomId}` (chỉ mục cũ được dọn).
Web hiện thanh "Bạn đang ở phòng X – Quay lại phòng" trên mọi trang và thẻ tương ứng ở sảnh; vẫn được **xem** phòng khác.

**Đi quân** (`submitMove {roomId, matchId, commandId, expectedVersion, from, to}`): UID lấy từ auth.
Transaction trên trận chạy theo thứ tự:
1. Lệnh trùng `commandId` ⇒ trả kết quả cũ.
2. Kiểm tra là người chơi, trận đang diễn ra.
3. **Kiểm tra deadline trước** (quá hạn ⇒ kết thúc do hết giờ).
4. `expectedVersion == v`.
5. Đúng lượt.
6. Luật cờ: replay toàn bộ nước để có lịch sử lặp.
7. Cập nhật đồng hồ, tăng `v`, ghi `cmds`.
8. Nếu ván kết thúc: ghi `result` + `outbox` trong **cùng** transaction.

Sau commit: hẹn Cloud Task cho deadline mới; nếu ván kết thúc thì ghi `pendingResults` và chuyển phòng sang `finished`.

**Client**: hiển thị nước lạc quan (quân mờ) và khóa bàn tới khi RTDB có `v` mới. Bị từ chối ⇒ rollback và báo tiếng Việt.
Lỗi mạng ⇒ gửi lại **cùng** `commandId` tối đa 3 lần.

**Đồng hồ**: server lưu `remaining` từng bên + `turnStartedAt` (ms UTC). Client nội suy để hiển thị bằng `.info/serverTimeOffset`,
không ghi DB mỗi giây. Hai nước đầu không trừ giờ; mỗi bên có 30 giây để đi nước đầu, quá hạn ⇒ trận `aborted` (không tính điểm).
Ân hạn mạng cố định 250 ms. Hết giờ được xử bởi:
1. Cloud Task tại deadline (bỏ qua nếu `v` đã đổi).
2. `sweepDeadlines` mỗi phút.
3. `claimTimeout` từ client.

Cả ba đều đi qua cùng một hàm thuần nên kết quả chỉ ghi một lần. Cách này vẫn đúng khi cả hai client đã đóng.

**Race**: đi quân, đầu hàng, hòa, hết giờ cùng tranh một transaction. Lệnh nào commit trước quyết định kết quả; lệnh sau nhận `game_over`/`stale_version`.

**Mất kết nối**: không xử thua ngay, đồng hồ vẫn chạy. Sau ≥60 giây đối thủ offline liên tục (không còn `roomViewers`, đo bằng `roomLastSeen`),
người chơi kia có thể `claimAbandon`.

**Kết quả → Firestore** (đúng một lần):
1. Trigger `onMatchOutbox` (retry) và `reconcileResults` (5 phút) gọi `processResult`.
2. Firestore transaction: nếu `ratingLedger/{matchId}` đã có ⇒ bỏ qua. Nếu chưa ⇒ đọc stats **hiện tại** của 2 người, tính Elo, ghi stats + leaderboard + archive + history + ledger.
3. Sau đó đánh dấu outbox done và gỡ lease `mm/active`.

Không có transaction xuyên RTDB–Firestore. Tính đúng-một-lần dựa vào ledger.

**Thứ tự rating theo người chơi**: lease `mm/active/{uid}` chỉ được gỡ **sau khi** rating đã ghi. Vì vậy một UID không thể có 2 trận rated song song,
và không thể bắt đầu trận rated mới khi trận trước chưa tính xong (mmEnqueue trả `settling`). Rating không bao giờ tính từ dữ liệu cũ.

**Ghép trận**: transaction trên `mm`. Khoảng rating = 100 + 25 × (giây chờ / 5), tối đa 600; lấy min của hai bên.
Chống tự ghép, chống enqueue trùng (khóa theo UID), mục chờ không heartbeat 20 giây bị loại.
Hủy sau khi đã ghép ⇒ trả `matched` (không mất trận). Phòng ranked được tạo idempotent; nếu Function dừng giữa chừng, lần poll sau sẽ phục hồi.

**Elo** (`elo-v1`): khởi điểm 1200; K=40 cho 10 trận rated đầu, sau đó K=32; sàn 100. Lên bảng cần 5 trận rated.
Tỉ lệ thắng = thắng ÷ trận rated (hòa không tính thắng).
Hạng hiển thị trên bảng = vị trí trong thứ tự (rating giảm dần, uid tăng dần), các trang được tải tuần tự từ đầu bảng.
"Hạng của bạn" = 1 + số người có rating cao hơn (count aggregation).

**Đa ngôn ngữ** (i18next): toàn bộ chữ giao diện nằm trong `apps/web/src/i18n/{vi,en}.ts`. Server không dịch: mỗi lỗi có `details.key`
(callable) hoặc `messageKey` (phản hồi lệnh trận) lấy từ danh mục `functions/src/messages.ts`; web tra khóa đó trong `serverErrors.*`.
Tên khách mặc định tạo theo ngôn ngữ lúc tạo ("Khách ABC123" / "Guest ABC123") và là dữ liệu của người chơi (không tự dịch lại).

## 7. Kiểm thử (kết quả lần chạy gần nhất)

| Bộ | Lệnh | Kết quả |
|---|---|---|
| Luật + AI | `npm run test:engine` | 51/51 |
| Lõi server | `npm run test:unit` | 30/30 |
| Security Rules | `npm run test:rules` | 16/16 |
| Integration (emulator) | `npm run test:integration` | 13/13 |
| E2E Playwright | `npm run test:e2e` | 3/3 |

## 8. Hạn chế đã biết

- Luật giản lược: chưa phân xử trường tróc, chưa có luật giải đấu đầy đủ.
- **Khách được đấu xếp hạng** (theo yêu cầu): một người có thể tạo nhiều tài khoản khách (trình duyệt ẩn danh, xóa dữ liệu) để
  chơi lại từ 1200 hoặc tự đấu với chính mình để đẩy rating. Bảng xếp hạng vì vậy kém tin cậy hơn so với chỉ cho tài khoản Google/email.
  Giảm thiểu hiện có: rate limit theo UID, App Check (tùy chọn), cần 5 trận rated mới lên bảng.
- Ghép trận tuần tự hóa qua một node `mm`; chưa shard.
- Emulator không chạy job theo lịch và không tôn trọng giờ hẹn Cloud Tasks. Ở local, hết giờ dựa vào `claimTimeout` của client. Production có đủ 3 lớp.
- Bundle web ~1 MB (gzip ~330 KB), phần lớn là Firebase SDK. Chưa code-split riêng phần online.
- Chưa có chat, cờ úp, giải đấu, thanh toán (ngoài phạm vi).
- Đã deploy lên `co-tuong-online-81005` (04/11/2026). Bộ test tự động (rules/integration/E2E) chạy trên Emulator Suite;
  trên bản thật mới chạy smoke test (đăng nhập khách, tạo/rời phòng, rules chặn ghi). Hẹn giờ Cloud Tasks và job theo lịch
  chưa được quan sát chạy thật.
