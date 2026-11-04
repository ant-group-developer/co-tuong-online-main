#!/bin/sh
# Chạy mỗi lần container khởi động: sinh /env-config.js từ biến môi trường VITE_* (file .env).
# Nhờ vậy đổi .env rồi `docker compose up -d` là có hiệu lực, không cần build lại image.
set -eu

OUT=/usr/share/nginx/html/env-config.js
KEYS="VITE_APP_NAME VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_DATABASE_URL \
VITE_FIREBASE_APP_ID VITE_FIREBASE_STORAGE_BUCKET VITE_FIREBASE_MESSAGING_SENDER_ID VITE_FUNCTIONS_REGION \
VITE_APPCHECK_RECAPTCHA_ENTERPRISE_KEY"

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

{
  echo "// Sinh tự động lúc container khởi động – đừng sửa tay."
  echo "window.__XQ_ENV__ = {"
  for k in $KEYS; do
    eval "v=\${$k:-}"
    printf '  "%s": "%s",\n' "$k" "$(esc "$v")"
  done
  echo "};"
} > "$OUT"

for k in VITE_FIREBASE_API_KEY VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_DATABASE_URL; do
  eval "v=\${$k:-}"
  [ -n "$v" ] || echo "[xq] CẢNH BÁO: thiếu $k trong .env – chế độ online sẽ tắt, chỉ chơi được với máy." >&2
done
echo "[xq] env-config.js đã sinh (project: ${VITE_FIREBASE_PROJECT_ID:-<trống>})"
