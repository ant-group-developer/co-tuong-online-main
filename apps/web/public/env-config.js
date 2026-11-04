// Cấu hình lúc chạy. Khi chạy bằng Docker, file này được container sinh lại từ biến môi trường (.env).
// Ngoài Docker (npm run dev / Firebase Hosting) để trống: web dùng giá trị Vite nhúng lúc build (file .env ở thư mục gốc).
window.__XQ_ENV__ = window.__XQ_ENV__ || {};
