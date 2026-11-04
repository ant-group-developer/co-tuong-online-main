// Chạy lệnh (thường là firebase-tools) với JAVA portable trong .tools/ nếu máy chưa cài Java.
// Emulator Firestore/RTDB cần Java 21+. Dùng: node scripts/with-java.mjs firebase emulators:start
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(root, '.tools');
const env = { ...process.env };
if (existsSync(tools)) {
  const jdk = readdirSync(tools).find((d) => d.startsWith('jdk'));
  if (jdk) {
    const home = path.join(tools, jdk);
    env.JAVA_HOME = home;
    env.PATH = `${path.join(home, 'bin')}${path.delimiter}${env.PATH ?? env.Path ?? ''}`;
    env.Path = env.PATH;
  }
}
// Ưu tiên firebase-tools cài trong repo (đã pin version).
env.PATH = `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${env.PATH}`;
env.Path = env.PATH;

// Functions emulator (project demo-*) mặc định dùng namespace "<project>" – namespace KHÔNG có rules.
// Ép dùng "<project>-default-rtdb" giống production để rules trong firebase.json được áp dụng.
if (!env.DATABASE_URL) env.DATABASE_URL = 'https://demo-xiangqi-default-rtdb.firebaseio.com';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Thiếu lệnh. Ví dụ: node scripts/with-java.mjs firebase emulators:start');
  process.exit(1);
}
// 'firebase' được chạy trực tiếp bằng node (không qua shell) để giữ nguyên tham số có dấu cách.
const fbBin = path.join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const child =
  cmd === 'firebase' && existsSync(fbBin)
    ? spawn(process.execPath, [fbBin, ...args], { stdio: 'inherit', env, cwd: root })
    : spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32', cwd: root });
child.on('exit', (code) => process.exit(code ?? 1));
