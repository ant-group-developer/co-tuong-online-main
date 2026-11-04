import { defineConfig } from '@playwright/test';

/**
 * E2E chạy với Emulator Suite (npm run test:e2e). Dùng Chrome đã cài trên máy (channel: 'chrome').
 * Đổi PW_CHANNEL=chromium nếu đã chạy `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    // Giao diện tự chọn ngôn ngữ theo trình duyệt: cố định tiếng Việt cho các test (test đổi ngôn ngữ tự bấm EN).
    locale: 'vi-VN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:emu -w apps/web -- --port 5174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: '..',
  },
});
