// Bundle Functions bằng esbuild: engine (@xq/engine) được nhúng thẳng vào lib/index.js,
// nên thư mục functions/ deploy độc lập, không cần workspace hay package nội bộ trên Cloud Build.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const engine = fileURLToPath(new URL('../packages/engine/src/index.ts', import.meta.url));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['firebase-admin', 'firebase-functions', 'firebase-admin/*', 'firebase-functions/*'],
  alias: { '@xq/engine': engine },
  logLevel: 'info',
});
