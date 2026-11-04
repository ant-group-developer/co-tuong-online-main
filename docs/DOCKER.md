# Chạy bằng Docker

Một container web (nginx), một port. Backend (đăng nhập, database, Cloud Functions) là project Firebase đã deploy,
nên không có gì khác phải chạy trong Docker.

## Chạy

```powershell
cd D:\ANT_1\xiangqi-main\xiangqi-firebase
docker compose up -d --build
```

Mở <http://localhost:3000>.

## Cấu hình: file `.env` (thư mục gốc, cạnh `docker-compose.yml`)

| Biến | Ý nghĩa |
|---|---|
| `WEB_PORT` | Port mở web trên máy (mặc định 3000) |
| `VITE_APP_NAME` | Tên hiển thị |
| `VITE_FIREBASE_*` | Lấy từ Firebase Console → Project settings → Web app (`firebaseConfig`) |
| `VITE_FUNCTIONS_REGION` | Vùng Cloud Functions, giữ `asia-southeast1` |

Mẫu: `.env.example`. Sửa `.env` xong chạy `docker compose up -d` (không cần `--build`): khi khởi động, container
đọc `.env` và sinh `/env-config.js` cho web, nên image không chứa cấu hình.

## File

| File | Việc |
|---|---|
| `docker-compose.yml` | Service `web` |
| `docker/web/Dockerfile` | Build web bằng Vite, phục vụ bằng nginx |
| `docker/web/nginx.conf` | SPA, cache, header bảo mật |
| `docker/web/40-xq-runtime-env.sh` | Sinh `/env-config.js` từ `.env` lúc khởi động |

## Lệnh

```powershell
docker compose logs -f web      # dòng "[xq] env-config.js đã sinh (project: ...)" cho biết đang dùng project nào
docker compose up -d --build    # build lại sau khi sửa code
docker compose down             # dừng
```

## Deploy lên server: co-tuong.antfootage.net

Domain đi qua Cloudflare. Cloudflare **không** chuyển tiếp port 11426, nên người dùng vào `https://co-tuong.antfootage.net`
(port 443), còn nginx của aaPanel chuyển vào container ở `127.0.0.1:11426`.

```
Trình duyệt ──https──► Cloudflare ──► nginx aaPanel (80/443) ──► Docker web 127.0.0.1:11426
                    (Auth / Database / Functions đi thẳng tới Firebase, không qua server)
```

1. **Firebase Console** → Authentication → Settings → **Authorized domains** → Add domain → `co-tuong.antfootage.net`.
2. **Tải code lên server.** Trên máy Windows đã có sẵn gói `D:\ANT_1\xiangqi-main\co-tuong-deploy.tar.gz` (~0,2 MB, không có node_modules).
   Upload bằng File Manager của aaPanel hoặc `scp`, rồi trên server:
   ```bash
   mkdir -p /opt/co-tuong && tar -xzf co-tuong-deploy.tar.gz -C /opt/co-tuong
   cd /opt/co-tuong
   docker compose up -d --build
   curl -I http://127.0.0.1:11426/        # phải ra HTTP/1.1 200
   ```
   Tạo lại gói sau khi sửa code (chạy trong `xiangqi-firebase` trên Windows):
   ```powershell
   tar -czf ..\co-tuong-deploy.tar.gz --exclude=node_modules --exclude=dist docker-compose.yml .env .env.example .dockerignore .gitattributes docker package.json package-lock.json packages/engine apps/web
   ```
3. **aaPanel** → Website → `co-tuong.antfootage.net`:
   - Bật site (đang ở trạng thái *Stopped*).
   - **Reverse proxy** → Add → Target URL `http://127.0.0.1:11426`, Sent Domain `$host`. Mẫu cấu hình tương đương: `docker/nginx-reverse-proxy.conf`.
   - **SSL** → Let's Encrypt cho domain (hoặc dùng Cloudflare Origin Certificate).
4. **Cloudflare** → SSL/TLS → chế độ **Full** (nếu bước 3 đã có SSL) hoặc **Flexible** (nếu chưa).
5. Mở <https://co-tuong.antfootage.net> → chơi với máy, đăng nhập Google, vào Phòng & xem trận.

Cập nhật bản mới: upload gói mới, giải nén đè, `docker compose up -d --build`. Chỉ đổi `.env`: `docker compose up -d`.

## Lưu ý

- Mở web bằng IP/tên miền khác `localhost`: thêm vào Firebase Console → Authentication → Settings → **Authorized domains**,
  nếu không đăng nhập Google sẽ báo `auth/unauthorized-domain`.
- Docker không deploy Functions/Rules. Deploy vẫn bằng `npx firebase deploy` (xem `HUONG-DAN-CAU-HINH-FIREBASE.md`).
- Chạy Firebase giả lập trên máy (không cần project thật) dùng `npm run emulators` + `npm run dev:emu`, không qua Docker.
- Cùng file `.env` này cũng được dùng khi `npm run dev` và khi build/deploy lên Firebase Hosting. `apps/web` không có file env riêng.
