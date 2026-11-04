import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Đọc env từ THƯ MỤC GỐC repo: một file .env dùng chung cho npm run dev, build/deploy Hosting và Docker.
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  server: { port: 5173, host: true },
  preview: { port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
