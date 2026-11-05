/**
 * Cảnh 3D của bàn cờ (three.js r149): thư phòng cổ, bàn gỗ, quân đĩa khắc chữ Hán và hai nhân vật cổ trang.
 * Mọi thứ dựng bằng code (không dùng model/ảnh bên ngoài, trừ logo ANT ở sông lấy từ /river-logo.jpg).
 *
 * Cảnh KHÔNG giữ luật cờ: React đưa vào bàn hiện tại (tọa độ canonical) + nước vừa đi; cảnh tự diễn hoạt
 * cảnh "tay nhân vật cầm quân" khi bàn đổi đúng một nước, còn lại thì đặt quân ngay (undo, đồng bộ lại, ván mới).
 */
import * as THREE from 'three';
import { fromView, toView } from '@xq/engine';
import { isSingleMove, sameBoard, type MoveRef } from './diff';
import { buildCharacter, type Character } from './characters';
import { AVATAR_IDS, type AvatarId, type CamPreset, type GlyphFacing, type Mood } from '../lib/avatars';

THREE.ColorManagement.legacyMode = false;

type V3 = THREE.Vector3;
type Seat = 'top' | 'bottom';
type SideName = 'red' | 'black';

const BT = 0.35; // mặt bàn cờ (mặt bàn gỗ ở y = 0)
const SEAT_Z = 11.6;
const FLOOR_Y = -16;
const PI = Math.PI;
const PIECE_H = 0.24;
/** Đầu ngón kẹp quân ở lưng chừng thành quân. */
const GRIP_Y = PIECE_H * 0.6;
const GLYPH_FONT = 'KaiTi, STKaiti, "BiauKai", "DFKai-SB", "Kaiti TC", "Noto Serif CJK TC", "Noto Serif TC", "Songti TC", "PMingLiU", "Microsoft JhengHei", "PingFang TC", "SimSun", serif';

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const kf = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const damp = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * kf(k, dt);
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const UP = new THREE.Vector3(0, 1, 0);

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a ^= a << 13;
    a >>>= 0;
    a ^= a >>> 17;
    a ^= a << 5;
    a >>>= 0;
    return a / 4294967296;
  };
}

function std(color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...o });
}

interface MeshOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  noCast?: boolean;
  receive?: boolean;
}
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, o: MeshOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = !o.noCast;
  m.receiveShadow = !!o.receive;
  if (o.pos) m.position.set(...o.pos);
  if (o.rot) m.rotation.set(...o.rot);
  if (o.scale) m.scale.set(...o.scale);
  return m;
}
function lathe(pts: Array<[number, number]>, seg = 32): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    seg,
  );
}

/* ------------------------------------------------------------------ textures */
function woodCanvas(w: number, h: number, base: string, grain: string, seed: number, n: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const y = r() * h;
    const amp = 2 + r() * 7;
    const f = 80 + r() * 160;
    const ph = r() * 10;
    g.strokeStyle = `rgba(${grain},${(0.03 + r() * 0.09).toFixed(3)})`;
    g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath();
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x / f + ph) * amp + Math.sin(x / 23 + ph * 3) * 0.8);
    g.stroke();
  }
  return { c, g };
}
function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.encoding = THREE.sRGBEncoding;
  return t;
}

let riverLogo: HTMLImageElement | null = null;
let riverLogoReady: Promise<HTMLImageElement | null> | null = null;
function loadRiverLogo(): Promise<HTMLImageElement | null> {
  riverLogoReady ??= new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      riverLogo = img;
      res(img);
    };
    img.onerror = () => res(null);
    img.src = '/river-logo.jpg';
  });
  return riverLogoReady;
}

/** Mặt bàn cờ: lưới 9×10, cung, dấu pháo/tốt; giữa sông là logo ANT GROUP. Hàng 0 ở mép trên ảnh. */
function drawBoard(c: HTMLCanvasElement): void {
  const U = 100;
  const ox = 110;
  const oy = 110;
  const W = c.width;
  const H = c.height;
  const wc = woodCanvas(W, H, '#d9ab6c', '110,62,24', 7, 220);
  const g = c.getContext('2d')!;
  g.drawImage(wc.c, 0, 0);
  const X = (col: number) => ox + col * U;
  const Y = (row: number) => oy + row * U;
  g.strokeStyle = '#4a2a14';
  g.lineCap = 'square';
  g.lineWidth = 7;
  g.strokeRect(X(0) - 22, Y(0) - 22, 8 * U + 44, 9 * U + 44);
  g.lineWidth = 3.2;
  for (let r = 0; r < 10; r++) {
    g.beginPath();
    g.moveTo(X(0), Y(r));
    g.lineTo(X(8), Y(r));
    g.stroke();
  }
  for (let col = 0; col < 9; col++) {
    g.beginPath();
    if (col === 0 || col === 8) {
      g.moveTo(X(col), Y(0));
      g.lineTo(X(col), Y(9));
    } else {
      g.moveTo(X(col), Y(0));
      g.lineTo(X(col), Y(4));
      g.moveTo(X(col), Y(5));
      g.lineTo(X(col), Y(9));
    }
    g.stroke();
  }
  for (const [a, b] of [
    [0, 2],
    [7, 9],
  ]) {
    g.beginPath();
    g.moveTo(X(3), Y(a));
    g.lineTo(X(5), Y(b));
    g.moveTo(X(5), Y(a));
    g.lineTo(X(3), Y(b));
    g.stroke();
  }
  const mark = (col: number, row: number) => {
    const d = 9;
    const l = 22;
    g.lineWidth = 2.6;
    for (const sx of [-1, 1]) {
      if ((sx < 0 && col === 0) || (sx > 0 && col === 8)) continue;
      for (const sy of [-1, 1]) {
        g.beginPath();
        g.moveTo(X(col) + sx * d, Y(row) + sy * (d + l));
        g.lineTo(X(col) + sx * d, Y(row) + sy * d);
        g.lineTo(X(col) + sx * (d + l), Y(row) + sy * d);
        g.stroke();
      }
    }
  };
  for (const [col, row] of [
    [1, 2],
    [7, 2],
    [1, 7],
    [7, 7],
  ])
    mark(col, row);
  for (const col of [0, 2, 4, 6, 8]) {
    mark(col, 3);
    mark(col, 6);
  }
  // Sông: chỉ có logo ANT GROUP ở giữa.
  const my = Y(4.5);
  if (riverLogo) {
    // Ảnh 1280×1280 nền trắng: cắt biểu tượng + chữ, nhân màu (multiply) để nền trắng hòa vào vân gỗ.
    g.save();
    g.globalCompositeOperation = 'multiply';
    const k = U / 46; // bàn 2D dùng ô 46 đơn vị
    const iconW = 39.6 * k;
    const iconH = 32 * k;
    const textW = 114.6 * k;
    const textH = 15 * k;
    const x0 = ox + (126 - 23) * k;
    g.drawImage(riverLogo, 340, 280, 600, 485, x0, my - iconH / 2, iconW, iconH);
    g.drawImage(riverLogo, 105, 865, 1070, 140, ox + (173.6 - 23) * k, my - textH / 2, textW, textH);
    g.restore();
  }
}

function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1020;
  c.height = 1120;
  drawBoard(c);
  const t = tex(c);
  if (!riverLogo)
    void loadRiverLogo().then((img) => {
      if (!img) return;
      drawBoard(c);
      t.needsUpdate = true;
    });
  return t;
}

function scrollTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 760;
  const g = c.getContext('2d')!;
  const r = rng(11);
  g.fillStyle = '#ece0c6';
  g.fillRect(0, 0, 300, 760);
  g.fillStyle = '#5a3a22';
  g.fillRect(0, 0, 300, 26);
  g.fillRect(0, 734, 300, 26);
  for (let layer = 0; layer < 4; layer++) {
    const base = 520 - layer * 70;
    g.fillStyle = `rgba(40,36,34,${0.16 + layer * 0.12})`;
    g.beginPath();
    g.moveTo(20, 700);
    let x = 20;
    while (x < 280) {
      const w = 30 + r() * 60;
      const hgt = 60 + r() * 140 - layer * 10;
      g.quadraticCurveTo(x + w * 0.5, base - hgt, x + w, base - r() * 30);
      x += w;
    }
    g.lineTo(280, 700);
    g.closePath();
    g.fill();
  }
  g.fillStyle = 'rgba(40,36,34,0.55)';
  g.beginPath();
  g.arc(210, 150, 26, 0, PI * 2);
  g.fill();
  g.fillStyle = '#a8322a';
  g.fillRect(48, 610, 26, 26);
  return tex(c);
}

/* ------------------------------------------------------------------ phòng */
function lantern(scene: THREE.Scene, x: number, y: number, z: number): void {
  const g = new THREE.Group();
  const red = std(0xc23a2b, { emissive: 0xb02a1a, emissiveIntensity: 0.85, roughness: 0.8 });
  const gold = std(0xc9a14a, { roughness: 0.35, metalness: 0.7 });
  g.add(mesh(new THREE.SphereGeometry(1.8, 24, 18), red, { scale: [1, 0.85, 1], noCast: true }));
  const rib = std(0x7a1c12);
  for (let i = 0; i < 8; i++) {
    g.add(mesh(new THREE.TorusGeometry(1.8, 0.04, 4, 30, PI), rib, { rot: [0, (i / 8) * PI * 2, PI / 2], scale: [0.85, 1, 1], noCast: true }));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.35, 20), gold, { pos: [0, 1.6, 0], noCast: true }));
  g.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.35, 20), gold, { pos: [0, -1.6, 0], noCast: true }));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6), std(0xc23a2b), { pos: [0, -2.7, 0], noCast: true }));
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 14, 4), std(0x1a1a1a), { pos: [0, 8.8, 0], noCast: true }));
  g.position.set(x, y, z);
  scene.add(g);
  const pl = new THREE.PointLight(0xff7a4a, 0.5, 26, 2);
  pl.position.set(x, y, z);
  scene.add(pl);
}

function buildRoom(scene: THREE.Scene, lowShadow: boolean): void {
  scene.background = new THREE.Color(0x150f0b);
  scene.fog = new THREE.Fog(0x150f0b, 46, 95);
  scene.add(new THREE.HemisphereLight(0xfff0dc, 0x2b1b10, 0.55));
  const lamp = new THREE.SpotLight(0xffdcae, 1.25, 0, 0.72, 0.65, 1);
  lamp.position.set(0, 34, 1);
  lamp.target.position.set(0, 0, 0);
  lamp.castShadow = true;
  const sm = lowShadow ? 1024 : 2048;
  lamp.shadow.mapSize.set(sm, sm);
  lamp.shadow.camera.near = 8;
  lamp.shadow.camera.far = 70;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.radius = 3;
  scene.add(lamp, lamp.target);
  const fill = new THREE.DirectionalLight(0xffe9d2, 0.32);
  fill.position.set(6, 18, 30);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffc98f, 0.4);
  rim.position.set(-12, 16, -30);
  scene.add(rim);

  const fw = woodCanvas(1024, 1024, '#3a281b', '15,8,4', 3, 160);
  const ft = tex(fw.c);
  ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
  ft.repeat.set(4, 4);
  scene.add(mesh(new THREE.PlaneGeometry(140, 140), std(0xffffff, { map: ft, roughness: 0.85 }), { rot: [-PI / 2, 0, 0], pos: [0, FLOOR_Y, 0], receive: true, noCast: true }));
  scene.add(mesh(new THREE.PlaneGeometry(140, 70), std(0x3d2e22, { roughness: 0.95 }), { pos: [0, 19, -36], receive: true, noCast: true }));
  scene.add(mesh(new THREE.BoxGeometry(140, 1.6, 0.6), std(0x24180f), { pos: [0, FLOOR_Y + 0.8, -35.7], noCast: true }));
  const lacquer = std(0x5e1a12, { roughness: 0.45 });
  for (const x of [-27, 27]) {
    scene.add(mesh(new THREE.CylinderGeometry(1.4, 1.5, 70, 20), lacquer, { pos: [x, 19, -33.5], noCast: true }));
    scene.add(mesh(new THREE.CylinderGeometry(2.0, 2.2, 1.6, 20), std(0x2b1d14), { pos: [x, FLOOR_Y + 0.8, -33.5], noCast: true }));
  }
  scene.add(mesh(new THREE.BoxGeometry(60, 1.8, 1.4), lacquer, { pos: [0, 37, -34], noCast: true }));
  // Cửa sổ tròn có song gỗ
  const win = new THREE.Group();
  const R = 8;
  win.add(mesh(new THREE.CircleGeometry(R, 48), std(0xf2dcb3, { emissive: 0xf0c98a, emissiveIntensity: 0.6, roughness: 1 }), { noCast: true }));
  win.add(mesh(new THREE.TorusGeometry(R + 0.35, 0.6, 12, 64), std(0x2a1a10, { roughness: 0.5 }), { noCast: true }));
  const frameMat = std(0x2a1a10);
  for (let i = -3; i <= 3; i++) {
    const p = i * 2.2;
    const len = 2 * Math.sqrt(Math.max(0, R * R - p * p));
    if (len > 0.5) {
      win.add(mesh(new THREE.BoxGeometry(0.28, len, 0.25), frameMat, { pos: [p, 0, 0.12], noCast: true }));
      win.add(mesh(new THREE.BoxGeometry(len, 0.28, 0.25), frameMat, { pos: [0, p, 0.12], noCast: true }));
    }
  }
  win.position.set(16, 11, -35.8);
  scene.add(win);
  scene.add(mesh(new THREE.PlaneGeometry(6, 15.2), std(0xffffff, { map: scrollTexture(), roughness: 0.95 }), { pos: [-14, 10, -35.75], noCast: true }));
  scene.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 7, 12), std(0x2a1a10), { pos: [-14, 17.7, -35.6], rot: [0, 0, PI / 2], noCast: true }));
  lantern(scene, -21, 22, -24);
  lantern(scene, 21, 22, -24);
  // Đèn cung đình lục giác trên bàn
  const hexL = new THREE.Group();
  const dark = std(0x3a1d12);
  hexL.add(mesh(new THREE.CylinderGeometry(3.4, 3.0, 4.2, 6, 1, true), std(0xf3dfb6, { emissive: 0xf2c47c, emissiveIntensity: 0.9, side: THREE.DoubleSide }), { noCast: true }));
  hexL.add(mesh(new THREE.CylinderGeometry(3.8, 3.8, 0.4, 6), dark, { pos: [0, 2.3, 0], noCast: true }));
  hexL.add(mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.35, 6), dark, { pos: [0, -2.2, 0], noCast: true }));
  hexL.add(mesh(new THREE.ConeGeometry(2.4, 1.6, 6), dark, { pos: [0, 3.3, 0], noCast: true }));
  hexL.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 20, 4), std(0x111111), { pos: [0, 14, 0], noCast: true }));
  hexL.position.set(0, 31, 1);
  scene.add(hexL);
}

function buildTable(scene: THREE.Scene): void {
  const tw = woodCanvas(1024, 1024, '#4a2417', '20,8,3', 5, 220);
  const top = std(0xffffff, { map: tex(tw.c), roughness: 0.42 });
  const dark = std(0x34170e, { roughness: 0.5 });
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(17, 0.9, 15.5), top, { pos: [0, -0.45, 0], receive: true }));
  g.add(mesh(new THREE.BoxGeometry(16, 2, 14.5), dark, { pos: [0, -1.9, 0], receive: true }));
  for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(3.4, 0.25, 8, 24, PI), dark, { pos: [0, -2.9, s * 7.3], rot: [0, 0, PI], scale: [1.6, 0.35, 1] }));
  for (const [x, z] of [
    [-7.4, -6.6],
    [7.4, -6.6],
    [-7.4, 6.6],
    [7.4, 6.6],
  ]) {
    g.add(mesh(new THREE.BoxGeometry(1.2, 15, 1.2), dark, { pos: [x, FLOOR_Y + 7.5, z] }));
    g.add(mesh(new THREE.BoxGeometry(1.6, 0.8, 1.6), dark, { pos: [x, FLOOR_Y + 0.4, z] }));
  }
  scene.add(g);
  const b = new THREE.Group();
  b.add(mesh(new THREE.BoxGeometry(10.2, BT, 11.2), std(0xb98450, { roughness: 0.55 }), { pos: [0, BT / 2, 0], receive: true }));
  b.add(mesh(new THREE.PlaneGeometry(10.2, 11.2), std(0xffffff, { map: boardTexture(), roughness: 0.55 }), { rot: [-PI / 2, 0, 0], pos: [0, BT + 0.002, 0], receive: true, noCast: true }));
  scene.add(b);
}

/* ------------------------------------------------------------------ quân: đĩa gỗ khắc chữ */
export const GLYPHS: Record<SideName, string[]> = {
  red: ['', '帥', '仕', '相', '傌', '俥', '炮', '兵'],
  black: ['', '將', '士', '象', '馬', '車', '砲', '卒'],
};
const faceCache = new Map<string, THREE.CanvasTexture>();
const faceRedraws: Array<() => void> = [];
function drawFace(c: HTMLCanvasElement, glyph: string, side: SideName): void {
  const g = c.getContext('2d')!;
  const S = c.width;
  const r = S / 2;
  const grad = g.createRadialGradient(r * 0.85, r * 0.8, r * 0.1, r, r, r);
  grad.addColorStop(0, '#f3e2bd');
  grad.addColorStop(1, '#dcc08c');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const rr = rng(glyph.charCodeAt(0));
  for (let i = 0; i < 26; i++) {
    const y = rr() * S;
    g.strokeStyle = `rgba(140,95,45,${(0.04 + rr() * 0.06).toFixed(3)})`;
    g.lineWidth = 1 + rr() * 2;
    g.beginPath();
    for (let x = 0; x <= S; x += 12) g.lineTo(x, y + Math.sin(x / 40 + i) * 4);
    g.stroke();
  }
  const ink = side === 'red' ? '#b3121a' : '#0f0d0b';
  g.lineWidth = S * 0.026;
  g.strokeStyle = 'rgba(255,248,230,0.55)';
  g.beginPath();
  g.arc(r + 2, r + 2, r * 0.86, 0, PI * 2);
  g.stroke();
  g.strokeStyle = ink;
  g.beginPath();
  g.arc(r, r, r * 0.86, 0, PI * 2);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(S * 0.7)}px ${GLYPH_FONT}`;
  g.fillStyle = 'rgba(255,248,230,0.55)';
  g.fillText(glyph, r + 3, r + S * 0.04);
  g.fillStyle = ink;
  g.lineWidth = S * 0.012;
  g.strokeStyle = ink;
  g.strokeText(glyph, r, r + S * 0.03);
  g.fillText(glyph, r, r + S * 0.03);
}
function faceTexture(type: number, side: SideName): THREE.CanvasTexture {
  const key = side + type;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  drawFace(c, GLYPHS[side][type], side);
  const t = tex(c);
  faceCache.set(key, t);
  faceRedraws.push(() => {
    drawFace(c, GLYPHS[side][type], side);
    t.needsUpdate = true;
  });
  return t;
}
// Font hệ thống có thể nạp trễ: vẽ lại mặt quân khi trình duyệt báo font đã sẵn sàng.
if (typeof document !== 'undefined' && document.fonts?.ready) void document.fonts.ready.then(() => faceRedraws.forEach((f) => f()));

let pieceMats: { body: THREE.MeshStandardMaterial; groove: THREE.MeshStandardMaterial; faces: Map<string, THREE.MeshStandardMaterial> } | null = null;
function mats() {
  if (pieceMats) return pieceMats;
  const wt = woodCanvas(256, 64, '#e2c592', '140,95,45', 21, 30);
  const side = tex(wt.c);
  side.wrapS = THREE.RepeatWrapping;
  side.repeat.set(3, 1);
  pieceMats = { body: std(0xffffff, { map: side, roughness: 0.42 }), groove: std(0x6b4524, { roughness: 0.6 }), faces: new Map() };
  return pieceMats;
}
const DISC = lathe(
  [
    [0, 0],
    [0.39, 0],
    [0.425, 0.02],
    [0.44, 0.055],
    [0.44, 0.185],
    [0.425, 0.22],
    [0.395, 0.24],
    [0, 0.24],
  ],
  48,
);
const GROOVE = new THREE.TorusGeometry(0.442, 0.007, 4, 48);
const FACE = new THREE.CircleGeometry(0.392, 48);
const SHARED_GEOS = new Set<THREE.BufferGeometry>([DISC, GROOVE, FACE]);

interface PieceData {
  type: number;
  side: SideName;
  carried?: boolean;
}
function buildPiece(type: number, side: SideName): THREE.Group {
  const m = mats();
  let faceMat = m.faces.get(side + type);
  if (!faceMat) {
    const ft = faceTexture(type, side);
    // Tự phát sáng nhẹ bằng chính ảnh mặt quân: chữ luôn rõ dù quân nằm trong bóng tay/người.
    faceMat = std(0xffffff, { map: ft, emissive: 0xffffff, emissiveMap: ft, emissiveIntensity: 0.38, roughness: 0.6 });
    m.faces.set(side + type, faceMat);
  }
  const g = new THREE.Group();
  g.add(mesh(DISC, m.body));
  g.add(mesh(GROOVE, m.groove, { pos: [0, 0.12, 0], rot: [PI / 2, 0, 0], noCast: true }));
  g.add(mesh(FACE, faceMat, { rot: [-PI / 2, 0, 0], pos: [0, PIECE_H + 0.001, 0], noCast: true, receive: true }));
  g.userData = { type, side } satisfies PieceData;
  return g;
}

/* ------------------------------------------------------------------ khung render */
type FrameFn = ((dt: number, t: number) => void) & { dead?: boolean };
class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.5, 260);
  t = 0;
  size = { w: 1, h: 1 };
  onResize: ((w: number, h: number) => void) | null = null;
  private fns: FrameFn[] = [];
  private waiters: Array<{ at: number; res: () => void }> = [];
  private clock = new THREE.Clock();
  private visible = true;
  private raf = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    opts: { alpha?: boolean; maxDpr?: number },
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !!opts.alpha, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const host = canvas.parentElement ?? canvas;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((es) => {
        this.visible = es[0]?.isIntersecting ?? true;
      });
      this.io.observe(canvas);
    }
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** first: chạy trước các hàm khác trong khung (đặt đích cho tay trước khi nhân vật cập nhật). */
  onFrame(f: FrameFn, first = false): void {
    if (first) this.fns.unshift(f);
    else this.fns.push(f);
  }
  wait(sec: number): Promise<void> {
    return new Promise((res) => this.waiters.push({ at: this.t + sec, res }));
  }
  resize(): void {
    const p = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, p.clientWidth);
    const h = Math.max(1, p.clientHeight);
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize?.(w, h);
  }
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden) {
      this.clock.getDelta();
      return;
    }
    this.resize();
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.t >= this.waiters[i].at) this.waiters.splice(i, 1)[0].res();
    }
    for (const f of this.fns) if (!f.dead) f(dt, this.t);
    if (this.fns.some((f) => f.dead)) this.fns = this.fns.filter((f) => !f.dead);
    this.renderer.render(this.scene, this.camera);
  };
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.io?.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !SHARED_GEOS.has(m.geometry)) m.geometry.dispose();
    });
    this.renderer.dispose();
  }
}

/* ------------------------------------------------------------------ camera */
interface CamDef {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
  selfUpper: boolean;
}
const CAMS: Record<string, CamDef> = {
  third: { pos: [6.8, 21, 13], target: [0.1, 0.2, -0.4], fov: 46, selfUpper: true },
  seat: { pos: [0, 16.5, 11], target: [0, 0.4, -1.2], fov: 50, selfUpper: false },
  top: { pos: [0, 23.5, 3.4], target: [0, 0, -0.1], fov: 40, selfUpper: true },
  // Màn dọc (điện thoại)
  thirdTall: { pos: [3.4, 19, 10], target: [0, 0.2, -0.6], fov: 58, selfUpper: true },
  seatTall: { pos: [0, 15.5, 8], target: [0, 0.4, -1.0], fov: 62, selfUpper: false },
  topTall: { pos: [0, 18.5, 1.8], target: [0, 0, -0.05], fov: 58, selfUpper: true },
};

/* ------------------------------------------------------------------ cảnh bàn cờ */
export interface BoardSceneOptions {
  flipped: boolean;
  top: AvatarId;
  bottom: AvatarId;
  camera: CamPreset;
  glyphFacing: GlyphFacing;
  onTap: (sq: number) => void;
}

const FULL_SET: Record<number, number> = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 5 };

export class BoardScene {
  private stage: Stage;
  private pieces = new Map<number, THREE.Group>(); // ô canonical -> quân
  private piecesRoot = new THREE.Group();
  private pile = new THREE.Group();
  private board: number[] | null = null;
  private queue: Array<{ board: number[]; last: MoveRef | null; check: SideName | null }> = [];
  private animating = false;
  private flipped: boolean;
  private glyphFacing: GlyphFacing;
  private chars: Record<Seat, Character>;
  private avatars: Record<Seat, AvatarId>;
  private camName: CamPreset;
  private camCur = { pos: v3(), target: v3(), fov: 44 };
  private camGoal = { pos: v3(), target: v3(), fov: 44, selfUpper: true };
  private orbit = { yaw: 0, pitch: 0, zoom: 1 };
  private marks: { sel: THREE.Mesh; dots: THREE.Mesh[]; caps: THREE.Mesh[]; lastFrom: THREE.Mesh; lastTo: THREE.Mesh; check: THREE.Mesh; gold: THREE.MeshStandardMaterial; red: THREE.MeshStandardMaterial };
  private selected = -1;
  private disposed = false;
  private onTap: (sq: number) => void;
  private listeners = new AbortController();
  /** Sai lệch lớn nhất giữa đầu ngón và quân trong lần cầm quân gần nhất (kiểm thử). */
  gripErr = 0;

  constructor(canvas: HTMLCanvasElement, opts: BoardSceneOptions) {
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.stage = new Stage(canvas, { maxDpr: small ? 1.5 : 1.75 });
    this.flipped = opts.flipped;
    this.glyphFacing = opts.glyphFacing;
    this.camName = opts.camera;
    this.onTap = opts.onTap;
    const scene = this.stage.scene;
    void loadRiverLogo();
    buildRoom(scene, small);
    buildTable(scene);
    scene.add(this.piecesRoot, this.pile);

    const gold = std(0xe9bb4f, { emissive: 0xc8901c, emissiveIntensity: 0.55, roughness: 0.35, transparent: true, opacity: 0.95 });
    const blue = std(0x8cc8ff, { emissive: 0x3b7fd0, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 });
    const red = std(0xff6a5c, { emissive: 0xd2291c, emissiveIntensity: 0.9, transparent: true, opacity: 0.9 });
    const ring = (r: number, t: number, m: THREE.Material) => {
      const x = mesh(new THREE.TorusGeometry(r, t, 8, 40), m, { rot: [PI / 2, 0, 0], noCast: true });
      x.visible = false;
      scene.add(x);
      return x;
    };
    const square = () => {
      const x = mesh(new THREE.RingGeometry(0.4, 0.48, 4, 1), blue, { rot: [-PI / 2, 0, PI / 4], noCast: true });
      x.visible = false;
      scene.add(x);
      return x;
    };
    const dots: THREE.Mesh[] = [];
    const caps: THREE.Mesh[] = [];
    for (let i = 0; i < 20; i++) {
      const d = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 20), gold, { noCast: true });
      d.visible = false;
      scene.add(d);
      dots.push(d);
      caps.push(ring(0.52, 0.04, gold));
    }
    this.marks = { sel: ring(0.52, 0.045, gold), dots, caps, lastFrom: square(), lastTo: square(), check: ring(0.54, 0.06, red), gold, red };

    this.avatars = { top: opts.top, bottom: opts.bottom };
    this.chars = { top: this.placeChar('top', opts.top), bottom: this.placeChar('bottom', opts.bottom) };
    this.applyCamera(true);
    this.stage.onResize = () => this.applyCamera(false);

    this.stage.onFrame((dt, t) => this.frame(dt, t));
    this.bindInput(canvas);
  }

  private placeChar(seat: Seat, id: AvatarId): Character {
    const c = buildCharacter(AVATAR_IDS.includes(id) ? id : 'thusinh', BT);
    if (seat === 'top') c.group.position.set(0, 0, -SEAT_Z);
    else {
      c.group.position.set(0, 0, SEAT_Z);
      c.group.rotation.y = PI;
    }
    c.lookAt(v3(0, BT, 0));
    this.stage.scene.add(c.group);
    return c;
  }

  /** Ô canonical -> vị trí trên bàn (người ngồi dưới ở phía +z). */
  private sqPos(sq: number, y = BT): V3 {
    const v = toView(sq, this.flipped);
    return v3(v.col - 4, y, v.row - 4.5);
  }
  private seatOfSide(side: SideName): Seat {
    const bottomSide: SideName = this.flipped ? 'black' : 'red';
    return side === bottomSide ? 'bottom' : 'top';
  }
  private orient(g: THREE.Group): void {
    const d = g.userData as PieceData;
    g.rotation.y = this.glyphFacing === 'owner' && this.seatOfSide(d.side) === 'top' ? PI : 0;
  }

  private applyCamera(instant: boolean): void {
    const { w, h } = this.stage.size;
    const tall = w / h < 0.9;
    const def = CAMS[tall ? `${this.camName}Tall` : this.camName] ?? CAMS.third;
    this.camGoal.pos.set(...def.pos);
    this.camGoal.target.set(...def.target);
    this.camGoal.fov = def.fov;
    this.camGoal.selfUpper = def.selfUpper;
    this.chars.bottom.setUpperVisible(def.selfUpper);
    if (instant) {
      this.camCur.pos.copy(this.camGoal.pos);
      this.camCur.target.copy(this.camGoal.target);
      this.camCur.fov = def.fov;
    }
  }

  private frame(dt: number, t: number): void {
    const cam = this.stage.camera;
    const k = kf(4, dt);
    this.camCur.pos.lerp(this.camGoal.pos, k);
    this.camCur.target.lerp(this.camGoal.target, k);
    this.camCur.fov = damp(this.camCur.fov, this.camGoal.fov, 4, dt);
    const off = this.camCur.pos.clone().sub(this.camCur.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += this.orbit.yaw;
    sph.phi = clamp(sph.phi - this.orbit.pitch, 0.12, 1.45);
    sph.radius *= this.orbit.zoom;
    cam.position.setFromSpherical(sph).add(this.camCur.target);
    cam.fov = this.camCur.fov;
    cam.updateProjectionMatrix();
    cam.lookAt(this.camCur.target);

    for (const [sq, g] of this.pieces) {
      if ((g.userData as PieceData).carried) continue;
      const goal = (sq === this.selected ? 0.18 + Math.sin(t * 4) * 0.025 : 0) + BT;
      g.position.y = damp(g.position.y, goal, 12, dt);
    }
    this.marks.gold.emissiveIntensity = 0.45 + Math.sin(t * 4) * 0.15;
    if (this.marks.check.visible) this.marks.red.emissiveIntensity = 0.7 + Math.sin(t * 8) * 0.3;

    this.chars.top.update(dt, t, cam.position);
    this.chars.bottom.update(dt, t, this.chars.top.head.getWorldPosition(v3()));
  }

  /* ---------- quân */
  private snap(board: number[]): void {
    this.piecesRoot.clear();
    this.pieces.clear();
    for (let sq = 0; sq < 90; sq++) {
      const v = board[sq];
      if (!v) continue;
      const g = buildPiece(Math.abs(v), v > 0 ? 'red' : 'black');
      this.orient(g);
      g.position.copy(this.sqPos(sq));
      this.piecesRoot.add(g);
      this.pieces.set(sq, g);
    }
    // Quân đã bị ăn: xếp cạnh bàn, phía người đã ăn.
    this.pile.clear();
    for (const side of ['red', 'black'] as const) {
      const sign = side === 'red' ? 1 : -1;
      let idx = 0;
      for (let type = 1; type <= 7; type++) {
        let have = 0;
        for (let sq = 0; sq < 90; sq++) if (board[sq] === sign * type) have++;
        for (let i = have; i < FULL_SET[type]; i++) {
          const g = buildPiece(type, side);
          this.orient(g);
          g.position.copy(this.pileSlot(side, idx++));
          this.pile.add(g);
        }
      }
    }
    this.board = board.slice();
  }
  private pileCount(side: SideName): number {
    return this.pile.children.filter((c) => (c.userData as PieceData).side === side).length;
  }
  /** Vị trí quân bị ăn thứ idx của bên `side`, đặt bên phải người đã ăn nó. */
  private pileSlot(side: SideName, idx: number): V3 {
    const captor = this.seatOfSide(side === 'red' ? 'black' : 'red');
    const x = 6.4 + (idx % 2) * 0.95;
    const z = 4.6 - Math.floor(idx / 2) * 0.95;
    return captor === 'bottom' ? v3(x, 0, z) : v3(-x, 0, -z);
  }

  /** Bàn mới từ React. Nếu khác bàn đang hiển thị đúng một nước `last` thì diễn hoạt cảnh, ngược lại đặt ngay. */
  setBoard(board: ArrayLike<number>, last: MoveRef | null, check: SideName | null): void {
    const next = Array.from(board);
    if (this.board && sameBoard(this.board, next)) return;
    this.queue.push({ board: next, last, check });
    void this.drain();
  }
  private async drain(): Promise<void> {
    if (this.animating) return;
    this.animating = true;
    try {
      while (this.queue.length && !this.disposed) {
        // Bị dồn nhiều cập nhật (tab ẩn, mạng chập chờn): bỏ qua hoạt cảnh, nhảy tới bàn mới nhất.
        if (this.queue.length > 2) this.queue.splice(0, this.queue.length - 1);
        const item = this.queue.shift()!;
        const cur = this.board;
        const lm = item.last;
        if (cur && lm && isSingleMove(cur, item.board, lm)) await this.animate(cur, item.board, lm, item.check);
        else this.snap(item.board);
      }
    } finally {
      this.animating = false;
    }
  }

  /**
   * Hoạt cảnh đi quân như người thật: đưa tay tới quân, xòe ngón hạ xuống, kẹp, nhấc lên một chút, lướt sang ô đích,
   * đặt xuống đúng giao điểm, thả ngón rồi rút tay. Ăn quân thì nhặt quân bị ăn ra cạnh bàn trước.
   * Quân luôn đi đúng đường từ ô đi tới ô đến; tay bám theo quân (không phải ngược lại), nên không bị lệch ô.
   */
  private async animate(cur: number[], next: number[], m: MoveRef, check: SideName | null): Promise<void> {
    const g = this.pieces.get(m.from);
    if (!g) {
      this.snap(next);
      return;
    }
    const mover = (g.userData as PieceData).side;
    const seat = this.seatOfSide(mover);
    const ch = this.chars[seat];
    const fast = seat === 'bottom' ? 0.7 : 1;
    const victim = this.pieces.get(m.to) ?? null;
    const at = (p: V3, h = 0) => v3(p.x, p.y + GRIP_Y + h, p.z);
    const toP = this.sqPos(m.to);
    this.gripErr = 0;

    if (victim) {
      const vs = (victim.userData as PieceData).side;
      const slot = this.pileSlot(vs, this.pileCount(vs));
      ch.lookAt(toP);
      await this.pick(ch, victim.position, fast);
      this.pieces.delete(m.to);
      this.piecesRoot.remove(victim);
      this.pile.add(victim);
      (victim.userData as PieceData).carried = true;
      await this.carry(ch, victim, victim.position.clone(), slot, fast);
      ch.reach(at(slot), { curl: 0.3 });
      await this.stage.wait(0.1 * fast);
    }

    ch.lookAt(g.position);
    await this.pick(ch, g.position, fast);
    (g.userData as PieceData).carried = true;
    ch.lookAt(toP);
    await this.carry(ch, g, g.position.clone(), toP, fast);
    (g.userData as PieceData).carried = false;
    g.position.copy(toP);
    this.pieces.delete(m.from);
    this.pieces.set(m.to, g);
    this.board = next.slice();
    this.reactTo(mover, victim ? Math.abs(cur[m.to]) : 0, check);
    // thả ngón, nhấc tay khỏi quân rồi rút về
    ch.reach(at(toP), { curl: 0.3 });
    await this.stage.wait(0.12 * fast);
    ch.reach(at(toP, 0.9), { curl: 0.35 });
    await this.stage.wait(0.16 * fast);
    ch.reach(null);
    ch.lookAt(v3(0, BT, 0));
  }
  /** Đưa tay tới phía trên quân ở p (đáy quân), xòe ngón hạ xuống rồi kẹp lại. */
  private async pick(ch: Character, p: V3, fast: number): Promise<void> {
    const over = v3(p.x, p.y + GRIP_Y + 0.8, p.z);
    const grip = v3(p.x, p.y + GRIP_Y, p.z);
    await this.handTo(ch, over, 0.3, 0.9 * fast, 0.25);
    await this.handTo(ch, grip, 0.3, 0.4 * fast, 0.05);
    ch.reach(grip, { curl: 0.72 });
    await this.stage.wait(0.1 * fast);
  }
  /** Đưa điểm kẹp tới p, chờ tới nơi (sai số tol) nhưng không quá max giây. */
  private handTo(ch: Character, p: V3, curl: number, max: number, tol: number): Promise<void> {
    ch.reach(p, { curl });
    const hand = v3();
    const t0 = this.stage.t;
    return new Promise((res) => {
      const fn: FrameFn = () => {
        if (this.disposed || this.stage.t - t0 >= max || ch.handGrip(hand).distanceTo(p) < tol) {
          fn.dead = true;
          res();
        }
      };
      this.stage.onFrame(fn);
    });
  }
  /** Cầm obj đi từ a tới b (vị trí đáy quân): nhấc lên thấp, lướt, hạ xuống êm; tay bám đúng quân từng khung. */
  private carry(ch: Character, obj: THREE.Object3D, a: V3, b: V3, fast: number): Promise<void> {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const dur = (0.3 + Math.min(dist, 10) * 0.055) * fast;
    const lift = 0.4 + Math.min(dist, 10) * 0.03;
    const t0 = this.stage.t;
    const want = v3();
    const hand = v3();
    const end = v3(b.x, b.y + GRIP_Y, b.z);
    let started = false;
    return new Promise((res) => {
      const fn: FrameFn = () => {
        // sai lệch tay - quân của khung trước (nhân vật đã cập nhật xong)
        if (started) this.gripErr = Math.max(this.gripErr, ch.handGrip(hand).distanceTo(want));
        started = true;
        const k = clamp((this.stage.t - t0) / dur, 0, 1);
        const e = ease(k);
        obj.position.lerpVectors(a, b, e);
        obj.position.y += lift * smooth(0, 0.3, k) * smooth(0, 0.3, 1 - k);
        want.set(obj.position.x, obj.position.y + GRIP_Y, obj.position.z);
        ch.reach(want, { tight: true, curl: 0.72, leanFor: end });
        if (k >= 1 || this.disposed) {
          fn.dead = true;
          res();
        }
      };
      this.stage.onFrame(fn, true);
    });
  }
  /** Nét mặt sau mỗi nước: bị ăn quân lớn thì buồn, bị chiếu thì giật mình, người ăn quân thì vui. */
  private reactTo(mover: SideName, capturedType: number, check: SideName | null): void {
    const t = this.stage.t;
    const other: SideName = mover === 'red' ? 'black' : 'red';
    const victimChar = this.chars[this.seatOfSide(other)];
    const moverChar = this.chars[this.seatOfSide(mover)];
    if (check === other) victimChar.setMood('surprised', 1.6, t);
    else if (capturedType) victimChar.setMood(capturedType === 5 || capturedType === 6 || capturedType === 4 ? 'sad' : 'surprised', 1.8, t);
    if (capturedType) moverChar.setMood('happy', 1.6, t);
  }

  /* ---------- đánh dấu */
  setMarks(selected: number | null, targets: number[], lastMove: MoveRef | null, checkSq: number | null): void {
    const mk = this.marks;
    this.selected = selected ?? -1;
    mk.sel.visible = selected !== null;
    if (selected !== null) mk.sel.position.copy(this.sqPos(selected, BT + 0.03));
    for (const d of mk.dots) d.visible = false;
    for (const c of mk.caps) c.visible = false;
    let di = 0;
    let ci = 0;
    for (const sq of targets) {
      if (this.board?.[sq]) {
        const c = mk.caps[ci++];
        if (c) {
          c.position.copy(this.sqPos(sq, BT + 0.03));
          c.visible = true;
        }
      } else {
        const d = mk.dots[di++];
        if (d) {
          d.position.copy(this.sqPos(sq, BT + 0.02));
          d.visible = true;
        }
      }
    }
    mk.lastFrom.visible = mk.lastTo.visible = !!lastMove;
    if (lastMove) {
      mk.lastFrom.position.copy(this.sqPos(lastMove.from, BT + 0.01));
      mk.lastTo.position.copy(this.sqPos(lastMove.to, BT + 0.01));
    }
    mk.check.visible = checkSq !== null;
    if (checkSq !== null) mk.check.position.copy(this.sqPos(checkSq, BT + 0.04));
    if (selected !== null) this.chars.bottom.lookAt(this.sqPos(selected));
  }

  /* ---------- nhân vật */
  setAvatar(seat: Seat, id: AvatarId): void {
    if (this.avatars[seat] === id) return;
    this.avatars[seat] = id;
    const old = this.chars[seat];
    const mood = old.mood;
    this.stage.scene.remove(old.group);
    old.dispose();
    this.chars[seat] = this.placeChar(seat, id);
    this.chars[seat].setAuto(mood === 'thinking' ? 'thinking' : 'idle');
    this.chars[seat].setMood(mood === 'thinking' ? 'thinking' : 'idle', 0, this.stage.t);
    if (seat === 'bottom') this.chars.bottom.setUpperVisible(this.camGoal.selfUpper);
  }
  /** Trạng thái lâu dài (đang nghĩ / thắng / thua) của một ghế. */
  setBaseMood(seat: Seat, mood: Mood): void {
    const c = this.chars[seat];
    c.setAuto(mood);
    c.setMood(mood, 0, this.stage.t);
  }
  /** Biểu cảm ngắn (emote). */
  emote(seat: Seat, mood: Mood): void {
    this.chars[seat].setMood(mood, 2.4, this.stage.t);
  }

  /* ---------- tùy chọn */
  setFlipped(f: boolean): void {
    if (f === this.flipped) return;
    this.flipped = f;
    if (this.board) this.snap(this.board);
  }
  setGlyphFacing(mode: GlyphFacing): void {
    this.glyphFacing = mode;
    for (const g of this.pieces.values()) this.orient(g);
    for (const c of this.pile.children) this.orient(c as THREE.Group);
  }
  setCamera(name: CamPreset): void {
    this.camName = name;
    this.resetView();
    this.applyCamera(false);
  }
  resetView(): void {
    this.orbit.yaw = 0;
    this.orbit.pitch = 0;
    this.orbit.zoom = 1;
  }

  /* ---------- chuột / chạm */
  private bindInput(canvas: HTMLCanvasElement): void {
    const signal = this.listeners.signal;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(v3(0, 1, 0), -BT);
    const ndc = new THREE.Vector2();
    const pick = (cx: number, cy: number): number => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.stage.camera);
      for (const h of ray.intersectObjects(this.piecesRoot.children, true)) {
        let o: THREE.Object3D | null = h.object;
        while (o && o.parent !== this.piecesRoot) o = o.parent;
        if (!o) continue;
        for (const [sq, g] of this.pieces) if (g === o && !(g.userData as PieceData).carried) return sq;
      }
      const p = v3();
      if (!ray.ray.intersectPlane(plane, p)) return -1;
      const col = Math.round(p.x + 4);
      const row = Math.round(p.z + 4.5);
      if (col < 0 || col > 8 || row < 0 || row > 9) return -1;
      if (Math.hypot(p.x - (col - 4), p.z - (row - 4.5)) > 0.48) return -1;
      return fromView(row, col, this.flipped);
    };
    let drag: { x: number; y: number; yaw: number; pitch: number; moved: boolean; id: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: this.orbit.yaw, pitch: this.orbit.pitch, moved: false, id: e.pointerId };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* bỏ qua */
      }
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (drag.moved) {
        this.orbit.yaw = clamp(drag.yaw - dx * 0.005, -0.75, 0.75);
        this.orbit.pitch = clamp(drag.pitch + dy * 0.004, -0.35, 0.4);
      }
    }, { signal });
    canvas.addEventListener('pointerup', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      if (!d.moved && !this.disposed) this.onTap(pick(e.clientX, e.clientY));
    }, { signal });
    canvas.addEventListener('pointercancel', () => {
      drag = null;
    }, { signal });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.orbit.zoom = clamp(this.orbit.zoom * (e.deltaY > 0 ? 1.07 : 0.93), 0.55, 1.3);
      },
      { passive: false, signal },
    );
    canvas.style.touchAction = 'none';
  }

  get busy(): boolean {
    return this.animating;
  }

  /** Tọa độ màn hình (px) của giao điểm theo hàng/cột hiển thị – dùng cho kiểm thử E2E. */
  screenOf(col: number, row: number): [number, number] {
    const v = v3(col - 4, BT + PIECE_H / 2, row - 4.5).project(this.stage.camera);
    const r = this.stage.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.abort();
    this.chars.top.dispose();
    this.chars.bottom.dispose();
    this.stage.dispose();
  }
}


/* ------------------------------------------------------------------ xem trước nhân vật (hồ sơ) */
export class CharacterPreview {
  private stage: Stage;
  private ch: Character;
  private mood: Mood = 'idle';
  private yaw = 0;
  private zoom = 1;
  private id: AvatarId;
  private listeners = new AbortController();

  constructor(canvas: HTMLCanvasElement, id: AvatarId) {
    this.id = id;
    this.stage = new Stage(canvas, { maxDpr: 2 });
    const scene = this.stage.scene;
    this.stage.camera.fov = 32;
    buildRoom(scene, true);
    buildTable(scene);
    const deco: Array<[number, SideName, number, number]> = [
      [1, 'black', 4, 0],
      [5, 'black', 0, 0],
      [4, 'black', 1, 0],
      [6, 'black', 1, 2],
      [7, 'black', 4, 3],
      [7, 'red', 4, 6],
      [6, 'red', 7, 7],
      [5, 'red', 8, 9],
      [4, 'red', 7, 9],
    ];
    for (const [type, side, col, row] of deco) {
      const g = buildPiece(type, side);
      g.position.set(col - 4, BT, row - 4.5);
      scene.add(g);
    }
    this.ch = this.make(id);
    const base = { pos: v3(6.5, 14, 13.5), target: v3(0, 6.6, -11) };
    let drag: { x: number; yaw: number } | null = null;
    const signal = this.listeners.signal;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, yaw: this.yaw };
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      if (drag) this.yaw = clamp(drag.yaw - (e.clientX - drag.x) * 0.004, -0.6, 0.6);
    }, { signal });
    const end = () => {
      drag = null;
    };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointerleave', end, { signal });
    // Cuộn để phóng to xem rõ mặt
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.3, 1.15);
      },
      { passive: false, signal },
    );
    canvas.style.touchAction = 'pan-y';
    const cam = this.stage.camera;
    const p = v3();
    this.stage.onFrame((dt, t) => {
      // phóng to: tiến lại gần và nhìn dần lên mặt
      const z = this.zoom;
      const tgt = v3(0, 6.6 + (1 - z) * 5.0, -11);
      p.copy(base.pos).sub(base.target).multiplyScalar(z).applyAxisAngle(UP, Math.sin(t * 0.25) * 0.12 + this.yaw).add(tgt);
      cam.position.copy(p);
      cam.lookAt(tgt);
      this.ch.lookAt(cam.position);
      this.ch.update(dt, t, cam.position);
    });
  }
  private make(id: AvatarId): Character {
    const c = buildCharacter(id, BT);
    c.group.position.set(0, 0, -SEAT_Z);
    c.lookAt(v3(0, BT, 0));
    c.setAuto(this.mood);
    c.setMood(this.mood, 0, this.stage.t);
    this.stage.scene.add(c.group);
    return c;
  }
  setCharacter(id: AvatarId): void {
    if (id === this.id) return;
    this.id = id;
    this.stage.scene.remove(this.ch.group);
    this.ch.dispose();
    this.ch = this.make(id);
  }
  setMood(m: Mood): void {
    this.mood = m;
    this.ch.setAuto(m);
    this.ch.setMood(m, 0, this.stage.t);
  }
  dispose(): void {
    this.listeners.abort();
    this.ch.dispose();
    this.stage.dispose();
  }
}

