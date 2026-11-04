import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@xq/engine': fileURLToPath(new URL('../packages/engine/src/index.ts', import.meta.url)),
    },
  },
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Integration/rules dùng chung emulator => chạy tuần tự để tránh nhiễu dữ liệu.
    fileParallelism: false,
  },
});
