/**
 * Nhân vật 3D dựng bằng code, theo tỉ lệ người thật (1 đơn vị ≈ 5 cm):
 *  - Đầu: khối cầu được "tạc" bằng hàm biến dạng (sọ, hàm, gò má, hốc mắt, sống mũi, môi, cằm) + 3 morph target
 *    (cười, mím/buồn, há miệng); da vẽ bằng canvas (môi, lỗ mũi, má hồng); mắt có tròng, mí trên/dưới chớp được; tai; lông mày.
 *  - Tay: lòng bàn tay + 5 ngón, mỗi ngón 2–3 đốt gập được (cầm quân, chống cằm, vẫy).
 *  - Trang phục: áo cổ trang (giao lĩnh), áo polo ANT GROUP, áo khoác Bách Khoa (HUST), áo khoác PTIT.
 * Gốc tọa độ: chỗ ngồi ngang mặt bàn, mặt hướng +z.
 */
import * as THREE from 'three';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarId, Mood } from '../lib/avatars';
import { antLogo, canvas2d, clamp, damp, hexCss, kf, lathe, loadAntLogo, LOGO_ICON, LOGO_TEXT, mesh, PI, rng, smooth, std, tex, v3, type V3 } from './util';

export const FLOOR_Y = -16;

type HairStyle = 'scholar' | 'lady' | 'elder' | 'general' | 'ponytail' | 'taoist' | 'messy' | 'neat' | 'bob';
type Outfit = 'hanfu' | 'polo' | 'hust' | 'ptit';
interface CharSpec {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  outfit: Outfit;
  female?: boolean;
  age?: 'young' | 'adult' | 'old';
  /** áo chính / viền / đai lưng / phụ kiện tóc */
  robe: number;
  band: number;
  sash: number;
  crown: number;
  lip: number;
  /** nghiêng lông mày mặc định (dương: đuôi mày nhướn) */
  brow: number;
  sleeve: 'wide' | 'narrow' | 'short' | 'long';
  pants: number;
  scale: number;
  flower?: number;
  beard?: 'long' | 'short' | 'goatee';
  armor?: number;
}

export const CHAR_SPECS: Record<AvatarId, CharSpec> = {
  thusinh: { skin: 0xefcfb2, hair: 0x15100d, hairStyle: 'scholar', outfit: 'hanfu', age: 'young', robe: 0xe2e3da, band: 0x2f4a6b, sash: 0x2f4a6b, crown: 0x7fae94, lip: 0xb46a5c, brow: 0.03, sleeve: 'wide', pants: 0xe2e3da, scale: 1 },
  tieuthu: { skin: 0xf4dac6, hair: 0x120d0b, hairStyle: 'lady', outfit: 'hanfu', female: true, age: 'young', robe: 0xd9928d, band: 0xf1e2c4, sash: 0xf1e2c4, crown: 0xd8b25a, flower: 0xc0392b, lip: 0xc2555a, brow: 0.02, sleeve: 'wide', pants: 0xd9928d, scale: 0.95 },
  laosu: { skin: 0xe2bc98, hair: 0xe8e5de, hairStyle: 'elder', outfit: 'hanfu', age: 'old', robe: 0x8a7558, band: 0x3c3227, sash: 0x3c3227, crown: 0x6b4a2b, lip: 0xa0675a, brow: -0.1, beard: 'long', sleeve: 'wide', pants: 0x8a7558, scale: 1 },
  tuongquan: { skin: 0xd8a982, hair: 0x120d0a, hairStyle: 'general', outfit: 'hanfu', age: 'adult', robe: 0x7a1f1c, band: 0x2a2320, sash: 0x2a2320, crown: 0xb08a3e, armor: 0x8c6d3a, lip: 0x9a5a4c, brow: 0.08, beard: 'short', sleeve: 'narrow', pants: 0x2a2320, scale: 1.05 },
  hiepnu: { skin: 0xf0cfb4, hair: 0x110c0a, hairStyle: 'ponytail', outfit: 'hanfu', female: true, age: 'young', robe: 0x293c3f, band: 0x8f2b25, sash: 0x8f2b25, crown: 0x8f2b25, lip: 0xb8534e, brow: 0.04, sleeve: 'narrow', pants: 0x293c3f, scale: 0.96 },
  daosi: { skin: 0xe6c19c, hair: 0x1a1410, hairStyle: 'taoist', outfit: 'hanfu', age: 'adult', robe: 0x5d7386, band: 0xe8e2d4, sash: 0x2b3a47, crown: 0xc9a24a, lip: 0xa66456, brow: 0.02, beard: 'goatee', sleeve: 'wide', pants: 0x5d7386, scale: 1 },
  antstaff: { skin: 0xf0d2bb, hair: 0x14100e, hairStyle: 'messy', outfit: 'polo', age: 'young', robe: 0xf6f7f9, band: 0x1f4fb0, sash: 0xf6f7f9, crown: 0x1f4fb0, lip: 0xc07a70, brow: -0.02, sleeve: 'short', pants: 0x2b3340, scale: 1 },
  hust: { skin: 0xe9c6a6, hair: 0x15110e, hairStyle: 'neat', outfit: 'hust', age: 'young', robe: 0xb3161c, band: 0xffffff, sash: 0xb3161c, crown: 0x1b2433, lip: 0xb06a5e, brow: 0.0, sleeve: 'long', pants: 0x23262e, scale: 1.02 },
  ptit: { skin: 0xf3d6c2, hair: 0x15100d, hairStyle: 'bob', outfit: 'ptit', female: true, age: 'young', robe: 0xe63b1f, band: 0xf7f6f2, sash: 0xf7f6f2, crown: 0xe63b1f, lip: 0xc8585a, brow: -0.03, sleeve: 'long', pants: 0x1c2540, scale: 0.95 },
};

/* ================================================================== ĐẦU */
const HS = 2.05; // tỉ lệ đầu (đầu cao ≈ 2·1.12·HS ≈ 4.6 đơn vị ≈ 23 cm)
interface FaceParams {
  smile: number;
  frown: number;
  open: number;
}
interface HeadKind {
  jaw: number;
  browRidge: number;
  nose: number;
  chin: number;
  lips: number;
}
const gauss = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) * (x - cx)) / (2 * sx * sx) + ((y - cy) * (y - cy)) / (2 * sy * sy)));

/** Hình đầu (chưa nhân HS) cho một hướng n trên mặt cầu đơn vị. */
function headShape(n: V3, kind: HeadKind, p: FaceParams, features = true): V3 {
  // Mặt cắt ngang gần vuông (siêu elip): mặt trước phẳng rộng như mặt người, không tròn như quả bóng.
  const rh = Math.hypot(n.x, n.z);
  const a = Math.atan2(n.x, n.z);
  const pw = n.z > 0 ? 2 / 2.7 : 2 / 2.25;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  let x = rh * Math.sign(sa) * Math.pow(Math.abs(sa), pw) * 0.79;
  const y0 = n.y * 1.12;
  let z = rh * Math.sign(ca) * Math.pow(Math.abs(ca), pw);
  const front = clamp(n.z, 0, 1);
  const low = smooth(-0.3, -1.08, y0);
  // hàm thon dần về cằm: thu cả bề ngang lẫn hai bên má (không chỉ bóp ngang, tránh mặt bị nhô như mõm)
  x *= 1 - kind.jaw * low * 1.15;
  z *= 1 - low * (0.28 * Math.abs(sa) + 0.06 * front);
  if (n.z < 0) z *= 1 - 0.38 * smooth(-0.15, -1, y0);
  z *= 1 - 0.07 * smooth(0.55, 1, n.z);
  if (!features) return v3(x, y0, z);
  const F = smooth(0.3, 0.72, n.z);
  if (F <= 0) return v3(x, y0, z);
  const y = y0;
  let dz = 0;
  let dy = 0;
  const g = (cx: number, cy: number, sx: number, sy: number) => gauss(x, y, cx, cy, sx, sy);
  dz += 0.05 * kind.nose * g(0, -0.14, 0.06, 0.2); // sống mũi
  dz += 0.085 * kind.nose * g(0, -0.38, 0.06, 0.065); // đầu mũi
  dz += 0.025 * kind.nose * (g(0.09, -0.43, 0.05, 0.04) + g(-0.09, -0.43, 0.05, 0.04)); // cánh mũi
  dz += kind.browRidge * (g(0.3, 0.2, 0.17, 0.05) + g(-0.3, 0.2, 0.17, 0.05)); // cung mày
  dz -= 0.05 * (g(0.32, 0.02, 0.13, 0.085) + g(-0.32, 0.02, 0.13, 0.085)); // hốc mắt
  dz += 0.03 * (g(0.46, -0.2, 0.16, 0.18) + g(-0.46, -0.2, 0.16, 0.18)); // gò má
  dz += 0.035 * kind.lips * g(0, -0.64, 0.17, 0.035); // môi trên
  dz += 0.035 * kind.lips * g(0, -0.76, 0.15, 0.035); // môi dưới
  dz -= 0.018 * g(0, -0.7, 0.2, 0.012); // khe miệng
  dz += kind.chin * g(0, -0.98, 0.13, 0.07); // cằm
  dz -= 0.015 * g(0, -0.55, 0.03, 0.04); // nhân trung
  const corners = g(0.23, -0.7, 0.07, 0.05) + g(-0.23, -0.7, 0.07, 0.05);
  dy += p.smile * 0.06 * corners;
  dz -= p.smile * 0.02 * corners;
  dz += p.smile * 0.03 * (g(0.33, -0.48, 0.12, 0.1) + g(-0.33, -0.48, 0.12, 0.1));
  dy -= p.frown * 0.05 * corners;
  dy -= p.open * 0.12 * smooth(-0.68, -0.8, y);
  dz -= p.open * 0.05 * g(0, -0.72, 0.08, 0.04);
  return v3(x, y + dy * F, z + dz * F);
}

/** Hướng trên mặt cầu ứng với tọa độ mặt (x,y) (đã biến dạng, chưa nhân HS) – để đặt mắt, tai, vẽ môi… */
function dirFromFace(x: number, y: number, kind: HeadKind, back = false): V3 {
  const ny = clamp(y / 1.12, -0.999, 0.999);
  let nx = x / 0.79;
  for (let i = 0; i < 4; i++) {
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * (back ? -1 : 1);
    const s = headShape(v3(nx, ny, nz), kind, { smile: 0, frown: 0, open: 0 }, false);
    if (Math.abs(s.x) > 1e-4) nx = clamp(nx * (x / s.x), -0.999, 0.999);
  }
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * (back ? -1 : 1);
  return v3(nx, ny, nz).normalize();
}
function surfaceAt(x: number, y: number, kind: HeadKind): V3 {
  return headShape(dirFromFace(x, y, kind), kind, { smile: 0, frown: 0, open: 0 }).multiplyScalar(HS);
}

function headGeometry(kind: HeadKind): THREE.BufferGeometry {
  const base = new THREE.SphereGeometry(1, 112, 84);
  const pos = base.attributes.position as THREE.BufferAttribute;
  const n = v3();
  const build = (p: FaceParams) => {
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      n.fromBufferAttribute(pos, i).normalize();
      const s = headShape(n, kind, p).multiplyScalar(HS);
      arr[i * 3] = s.x;
      arr[i * 3 + 1] = s.y;
      arr[i * 3 + 2] = s.z;
    }
    return arr;
  };
  const normalsOf = (arr: Float32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.setIndex(base.index);
    g.computeVertexNormals();
    return g.attributes.normal as THREE.BufferAttribute;
  };
  const geo = new THREE.BufferGeometry();
  const basePos = build({ smile: 0, frown: 0, open: 0 });
  geo.setAttribute('position', new THREE.BufferAttribute(basePos, 3));
  geo.setAttribute('uv', base.attributes.uv);
  geo.setIndex(base.index);
  geo.computeVertexNormals();
  const targets = [build({ smile: 1, frown: 0, open: 0 }), build({ smile: 0, frown: 1, open: 0 }), build({ smile: 0, frown: 0, open: 1 })];
  geo.morphAttributes.position = targets.map((a) => new THREE.BufferAttribute(a, 3));
  geo.morphAttributes.normal = targets.map((a) => normalsOf(a));
  base.dispose();
  return geo;
}

/** Da mặt (ảnh equirect theo UV của khối cầu): màu da, môi, lỗ mũi, má hồng, quầng mắt, râu lún phún. */
function skinTexture(spec: CharSpec, kind: HeadKind): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas2d(W, H);
  g.fillStyle = hexCss(spec.skin);
  g.fillRect(0, 0, W, H);
  const r = rng(spec.skin);
  for (let i = 0; i < 2600; i++) {
    const k = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${k},${k * 0.8},${k * 0.7},${(r() * 0.03).toFixed(3)})`;
    g.beginPath();
    g.arc(r() * W, r() * H, 1 + r() * 3, 0, PI * 2);
    g.fill();
  }
  const uv = (x: number, y: number): [number, number] => {
    const n = dirFromFace(x, y, kind);
    let phi = Math.atan2(n.z, -n.x);
    if (phi < 0) phi += PI * 2;
    return [(phi / (PI * 2)) * W, (Math.acos(clamp(n.y, -1, 1)) / PI) * H];
  };
  const blob = (x: number, y: number, rad: number, color: string) => {
    const [px, py] = uv(x, y);
    const gr = g.createRadialGradient(px, py, 0, px, py, rad);
    gr.addColorStop(0, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  };
  // má hồng, quầng mắt, sống mũi sáng
  const blushA = spec.female ? 0.28 : 0.14;
  blob(0.42, -0.3, 46, `rgba(222,120,110,${blushA})`);
  blob(-0.42, -0.3, 46, `rgba(222,120,110,${blushA})`);
  blob(0.32, 0.05, 30, 'rgba(90,55,45,0.14)');
  blob(-0.32, 0.05, 30, 'rgba(90,55,45,0.14)');
  blob(0, -0.2, 24, 'rgba(255,240,230,0.12)');
  if (!spec.female && spec.age !== 'young') {
    // râu lún phún vùng cằm/quai hàm
    for (const [x, y] of [
      [0, -0.95],
      [0.3, -0.85],
      [-0.3, -0.85],
      [0.15, -0.82],
      [-0.15, -0.82],
    ])
      blob(x, y, 36, 'rgba(60,50,60,0.18)');
  }
  // lỗ mũi
  g.fillStyle = 'rgba(90,45,40,0.45)';
  for (const s of [-1, 1]) {
    const [px, py] = uv(0.055 * s, -0.465);
    g.beginPath();
    g.ellipse(px, py, 3.2, 1.8, 0, 0, PI * 2);
    g.fill();
  }
  // môi: vẽ theo tọa độ mặt rồi chiếu sang UV
  const lip = new THREE.Color(spec.lip).lerp(new THREE.Color(spec.skin), spec.female ? 0.15 : 0.45);
  const lipCss = `rgb(${Math.round(lip.r * 255)},${Math.round(lip.g * 255)},${Math.round(lip.b * 255)})`;
  const w = spec.female ? 0.23 : 0.25;
  const path = (pts: Array<[number, number]>) => {
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [px, py] = uv(x, y);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
  };
  const upper: Array<[number, number]> = [];
  const lower: Array<[number, number]> = [];
  for (let i = 0; i <= 24; i++) {
    const x = -w + (2 * w * i) / 24;
    const t = x / w;
    const bow = 0.012 * Math.exp(-((x / 0.035) ** 2));
    upper.push([x, -0.7 + (0.045 + (spec.female ? 0.012 : 0)) * (1 - t * t) - bow]);
  }
  for (let i = 24; i >= 0; i--) upper.push([-w + (2 * w * i) / 24, -0.7]);
  for (let i = 0; i <= 24; i++) {
    const x = -w * 0.92 + (2 * w * 0.92 * i) / 24;
    lower.push([x, -0.7]);
  }
  for (let i = 24; i >= 0; i--) {
    const x = -w * 0.92 + (2 * w * 0.92 * i) / 24;
    const t = x / (w * 0.92);
    lower.push([x, -0.7 - (0.06 + (spec.female ? 0.015 : 0)) * (1 - t * t)]);
  }
  g.save();
  g.shadowColor = lipCss;
  g.shadowBlur = 6;
  g.fillStyle = lipCss;
  path(upper);
  g.fill();
  g.fillStyle = `rgb(${Math.round(Math.min(255, lip.r * 270))},${Math.round(lip.g * 255 * 1.02)},${Math.round(lip.b * 255 * 1.02)})`;
  path(lower);
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(80,30,30,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const [px, py] = uv(-w + (2 * w * i) / 24, -0.7);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();
  return tex(c);
}

function eyeTexture(iris: string): THREE.CanvasTexture {
  const { c, g } = canvas2d(256, 128);
  g.fillStyle = '#e6dfd6';
  g.fillRect(0, 0, 256, 128);
  // mạch máu nhạt ở rìa
  const r = rng(7);
  g.strokeStyle = 'rgba(200,90,90,0.25)';
  for (let i = 0; i < 18; i++) {
    g.beginPath();
    const x = 64 + (r() < 0.5 ? -1 : 1) * (40 + r() * 30);
    g.moveTo(x, 64 + (r() - 0.5) * 60);
    g.lineTo(x + (r() - 0.5) * 30, 64 + (r() - 0.5) * 60);
    g.stroke();
  }
  const cx = 64;
  const cy = 64;
  const gr = g.createRadialGradient(cx, cy, 2, cx, cy, 21);
  gr.addColorStop(0, '#120a06');
  gr.addColorStop(0.35, iris);
  gr.addColorStop(0.85, iris);
  gr.addColorStop(1, '#0d0704');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cx, cy, 21, 0, PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let a = 0; a < PI * 2; a += 0.25) {
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
    g.lineTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
    g.stroke();
  }
  g.fillStyle = '#050302';
  g.beginPath();
  g.arc(cx, cy, 7, 0, PI * 2);
  g.fill();
  return tex(c);
}

function lidTexture(spec: CharSpec, upper: boolean): THREE.CanvasTexture {
  const { c, g } = canvas2d(64, 64);
  g.fillStyle = hexCss(spec.skin);
  g.fillRect(0, 0, 64, 64);
  if (upper) {
    // nếp mí + hàng mi đậm ở mép
    g.fillStyle = 'rgba(110,70,60,0.35)';
    g.fillRect(0, 34, 64, 6);
    g.fillStyle = '#1a1210';
    g.fillRect(0, 64 - (spec.female ? 11 : 8), 64, spec.female ? 11 : 8);
  } else {
    g.fillStyle = 'rgba(80,50,45,0.6)';
    g.fillRect(0, 0, 64, 4);
  }
  return tex(c);
}

/* ================================================================== TAY */
interface Hand {
  group: THREE.Group;
  setCurl(c: number): void;
  grip: V3; // điểm kẹp quân (tọa độ trong bàn tay)
}
function buildHand(skinM: THREE.Material, nailM: THREE.Material, k: 'R' | 'L'): Hand {
  const s = k === 'R' ? 1 : -1; // ngón cái nằm phía +x với tay phải
  const group = new THREE.Group();
  group.add(mesh(new THREE.SphereGeometry(1, 20, 14), skinM, { pos: [0.02 * s, 0, 0.85], scale: [0.8, 0.27, 0.95] }));
  group.add(mesh(new THREE.SphereGeometry(1, 16, 10), skinM, { pos: [0, 0.02, 0.05], scale: [0.62, 0.32, 0.45] })); // cổ tay
  const joints: THREE.Group[][] = [];
  const fingers: Array<{ x: number; segs: number[]; r: number; z: number }> = [
    { x: 0.55, segs: [0.66, 0.42, 0.34], r: 0.19, z: 1.68 },
    { x: 0.18, segs: [0.74, 0.47, 0.36], r: 0.2, z: 1.76 },
    { x: -0.19, segs: [0.7, 0.44, 0.34], r: 0.19, z: 1.7 },
    { x: -0.53, segs: [0.52, 0.32, 0.28], r: 0.16, z: 1.55 },
  ];
  for (const f of fingers) {
    let parent: THREE.Object3D = group;
    const chain: THREE.Group[] = [];
    let z = f.z;
    let r = f.r;
    f.segs.forEach((len, i) => {
      const j = new THREE.Group();
      j.position.set(i === 0 ? f.x * s : 0, i === 0 ? -0.02 : 0, z);
      parent.add(j);
      const seg = mesh(new THREE.CapsuleGeometry(r, len - r, 4, 10), skinM, { pos: [0, 0, len / 2], rot: [PI / 2, 0, 0] });
      j.add(seg);
      if (i === f.segs.length - 1) j.add(mesh(new THREE.SphereGeometry(r * 0.75, 10, 6), nailM, { pos: [0, r * 0.55, len * 0.62], scale: [1, 0.35, 1.25], noCast: true }));
      chain.push(j);
      parent = j;
      z = len;
      r *= 0.9;
    });
    joints.push(chain);
  }
  // ngón cái
  const tb = new THREE.Group();
  tb.position.set(0.68 * s, -0.1, 0.55);
  tb.rotation.set(0.25, 0.75 * s, -0.5 * s);
  group.add(tb);
  tb.add(mesh(new THREE.CapsuleGeometry(0.23, 0.45, 4, 10), skinM, { pos: [0, 0, 0.32], rot: [PI / 2, 0, 0] }));
  const t2 = new THREE.Group();
  t2.position.set(0, 0, 0.62);
  tb.add(t2);
  t2.add(mesh(new THREE.CapsuleGeometry(0.2, 0.32, 4, 10), skinM, { pos: [0, 0, 0.26], rot: [PI / 2, 0, 0] }));
  t2.add(mesh(new THREE.SphereGeometry(0.15, 10, 6), nailM, { pos: [0, 0.13, 0.4], scale: [1, 0.35, 1.25], noCast: true }));
  return {
    group,
    grip: v3(0.25 * s, -0.55, 2.35),
    setCurl(c: number) {
      for (const chain of joints) {
        chain[0].rotation.x = 0.15 + 1.0 * c;
        chain[1].rotation.x = 0.2 + 1.15 * c;
        chain[2].rotation.x = 0.15 + 0.8 * c;
      }
      tb.rotation.x = 0.25 + 0.6 * c;
      t2.rotation.x = 0.1 + 0.7 * c;
    },
  };
}

/* ================================================================== THÂN & TRANG PHỤC */
const TORSO: Array<[number, number]> = [
  [0, -3.2],
  [3.5, -3.2],
  [3.65, -1],
  [3.45, 1.2],
  [3.7, 3.6],
  [3.85, 5.2],
  [3.6, 6.1],
  [2.55, 6.85],
  [1.3, 7.35],
  [0, 7.45],
];
const TORSO_Z = 0.64;
function torsoR(y: number): number {
  for (let i = 0; i < TORSO.length - 1; i++) {
    const [ra, ya] = TORSO[i];
    const [rb, yb] = TORSO[i + 1];
    if (y >= ya && y <= yb) return ra + ((y - ya) / (yb - ya || 1)) * (rb - ra);
  }
  return 0;
}
const frontZ = (x: number, y: number) => {
  const r = torsoR(y);
  return TORSO_Z * Math.sqrt(Math.max(0, r * r - x * x)) + 0.06;
};
function vOf(y: number): number {
  for (let i = 0; i < TORSO.length - 1; i++) {
    const a = TORSO[i][1];
    const b = TORSO[i + 1][1];
    if (y >= a && y <= b && b > a) return (i + (y - a) / (b - a)) / (TORSO.length - 1);
  }
  return y <= TORSO[0][1] ? 0 : 1;
}

/** Texture thân áo: vẽ theo tọa độ thân (x ngang, y cao) rồi chiếu lên UV của khối tiện. */
function torsoTexture(spec: CharSpec, onReady: () => void): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas2d(W, H);
  const P = (x: number, y: number, back = false): [number, number] => {
    const rr = torsoR(y) || 0.01;
    const a = Math.asin(clamp(x / rr, -1, 1));
    return [(back ? (a > 0 ? 1 - a / (2 * PI) : -a / (2 * PI)) : 0.5 + a / (2 * PI)) * W, (1 - vOf(y)) * H];
  };
  const line = (pts: Array<[number, number]>, w: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [px, py] = P(x, y);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.stroke();
  };
  const seg = (ax: number, ay: number, bx: number, by: number, w: number, col: string) => {
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= 20; k++) pts.push([ax + ((bx - ax) * k) / 20, ay + ((by - ay) * k) / 20]);
    line(pts, w, col);
  };
  const fill = (col: string) => {
    g.fillStyle = col;
    g.fillRect(0, 0, W, H);
  };
  const noise = (a: number) => {
    const r = rng(5);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(0,0,0,${(r() * a).toFixed(3)})`;
      g.fillRect(r() * W, r() * H, 2, 1 + r() * 6);
    }
  };
  const draw = () => {
    g.clearRect(0, 0, W, H);
    switch (spec.outfit) {
      case 'hanfu': {
        fill(hexCss(spec.robe));
        noise(0.035);
        const bandC = hexCss(spec.band);
        seg(-1.0, 7.45, -0.15, 6.15, 34, bandC);
        seg(1.2, 7.45, -0.45, 4.85, 30, '#f3efe6');
        seg(1.0, 7.45, -2.6, 3.0, 40, bandC);
        seg(1.0, 7.45, -2.6, 3.0, 3, 'rgba(255,240,200,0.35)');
        const y0 = (1 - vOf(1.6)) * H;
        const y1 = (1 - vOf(0.2)) * H;
        g.fillStyle = hexCss(spec.sash);
        g.fillRect(0, y0, W, y1 - y0);
        break;
      }
      case 'polo': {
        fill(hexCss(spec.robe));
        noise(0.02);
        // nẹp áo + đường may hai bên
        seg(-0.32, 7.3, -0.32, 5.4, 3, 'rgba(0,0,0,0.12)');
        seg(0.32, 7.3, 0.32, 5.4, 3, 'rgba(0,0,0,0.12)');
        seg(-0.32, 5.4, 0.32, 5.4, 3, 'rgba(0,0,0,0.12)');
        // logo ANT GROUP ở ngực trái
        const img = antLogo();
        if (img) {
          const [px, py] = P(1.55, 4.55);
          g.save();
          g.globalCompositeOperation = 'multiply';
          g.drawImage(img, LOGO_ICON[0], LOGO_ICON[1], LOGO_ICON[2], LOGO_ICON[3], px - 30, py - 44, 60, 48);
          g.drawImage(img, LOGO_TEXT[0], LOGO_TEXT[1], LOGO_TEXT[2], LOGO_TEXT[3], px - 46, py + 8, 92, 12);
          g.restore();
        }
        break;
      }
      case 'hust': {
        fill(hexCss(spec.robe));
        noise(0.05);
        // khóa kéo giữa
        seg(0, 7.4, 0, -3.2, 10, '#7d0d12');
        for (let y = 7.2; y > -3; y -= 0.12) seg(-0.07, y, 0.07, y, 2, 'rgba(40,0,0,0.6)');
        // viền trắng raglan
        seg(1.15, 7.3, 3.5, 3.9, 5, '#f4f4f4');
        seg(-1.15, 7.3, -3.5, 3.9, 5, '#f4f4f4');
        // chữ HUST ngực trái
        const [px, py] = P(1.65, 5.0);
        g.fillStyle = '#ffffff';
        g.font = 'italic 700 34px "Segoe UI", Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('HUST', px, py);
        // túi
        seg(1.6, 1.8, 1.9, 0.2, 4, 'rgba(60,0,0,0.5)');
        seg(-1.6, 1.8, -1.9, 0.2, 4, 'rgba(60,0,0,0.5)');
        break;
      }
      case 'ptit': {
        fill(hexCss(spec.band));
        noise(0.02);
        // phần đỏ cam: vai, hai bên sườn, viền quanh cổ
        g.fillStyle = hexCss(spec.robe);
        g.fillRect(0, 0, W, (1 - vOf(6.0)) * H);
        const side = (sx: number) => {
          g.beginPath();
          const pts: Array<[number, number]> = [
            [sx * 1.05, 7.4],
            [sx * 1.6, 6.0],
            [sx * 2.4, 4.6],
            [sx * 2.9, 2.6],
            [sx * 3.2, -3.2],
            [sx * 3.9, -3.2],
            [sx * 3.9, 7.4],
          ];
          pts.forEach(([x, y], i) => {
            const [px, py] = P(x, y);
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          });
          g.closePath();
          g.fill();
        };
        side(1);
        side(-1);
        // mặt sau đỏ
        const [bx] = P(3.9, 3);
        g.fillRect(bx, 0, W - bx, H);
        const [ax] = P(-3.9, 3);
        g.fillRect(0, 0, ax, H);
        // khóa kéo trắng xám
        seg(0, 7.4, 0, -3.2, 7, '#d8d8d8');
        // logo PTIT ngực trái
        const [px, py] = P(1.5, 4.7);
        g.strokeStyle = hexCss(spec.robe);
        g.lineWidth = 4;
        g.beginPath();
        g.ellipse(px - 4, py, 30, 24, -0.3, PI * 0.55, PI * 1.85);
        g.stroke();
        g.fillStyle = hexCss(spec.robe);
        g.font = '800 22px "Segoe UI", Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('PTIT', px + 6, py + 2);
        break;
      }
    }
  };
  draw();
  const t = tex(c);
  if (spec.outfit === 'polo' && !antLogo())
    void loadAntLogo().then((img) => {
      if (!img) return;
      draw();
      t.needsUpdate = true;
      onReady();
    });
  return t;
}

/** Texture tay áo: v=0 ở vai, v=1 ở khuỷu (bắp tay) hoặc khuỷu→cổ tay (cẳng tay). */
function sleeveTexture(spec: CharSpec, part: 'upper' | 'fore', side: 'R' | 'L'): THREE.CanvasTexture | null {
  if (spec.outfit === 'hanfu') return null;
  const { c, g } = canvas2d(256, 256);
  const skin = hexCss(spec.skin);
  if (spec.outfit === 'polo') {
    if (part === 'fore') return null;
    // tay ngắn: 55% áo trắng (phía vai) + viền xanh, phần còn lại là da
    g.fillStyle = skin;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = hexCss(spec.robe);
    g.fillRect(0, 256 * 0.45, 256, 256 * 0.55);
    g.fillStyle = hexCss(spec.band);
    g.fillRect(0, 256 * 0.45, 256, 18);
    return tex(c);
  }
  g.fillStyle = hexCss(spec.robe);
  g.fillRect(0, 0, 256, 256);
  const r = rng(part === 'upper' ? 3 : 4);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(0,0,0,${(r() * 0.05).toFixed(3)})`;
    g.fillRect(r() * 256, r() * 256, 2, 1 + r() * 8);
  }
  if (spec.outfit === 'hust' && part === 'upper' && side === 'L') {
    // huy hiệu tròn ở bắp tay trái (phía ngoài: u = 0.25)
    const cx = 64;
    const cy = 120;
    g.fillStyle = hexCss(spec.robe);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(cx, cy, 30, 34, 0, 0, PI * 2);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(cx, cy, 24, 28, 0, 0, PI * 2);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.fillRect(cx - 7, cy - 16, 14, 16);
    g.font = '700 11px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('1956', cx, cy + 14);
    // cành nguyệt quế hai bên
    g.beginPath();
    g.arc(cx, cy, 19, PI * 0.6, PI * 1.25);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 19, -PI * 0.25, PI * 0.4);
    g.stroke();
  }
  if (part === 'fore') {
    // bo chun ở cổ tay
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < 30; y += 6) g.fillRect(0, y, 256, 2);
  }
  return tex(c);
}

/* ================================================================== TÓC */
interface Hairline {
  front: number;
  side: number;
  back: number;
}
function hairMask(n: V3, h: Hairline): boolean {
  const frontW = smooth(0.15, 0.75, n.z);
  const sideW = smooth(0.35, 0.85, Math.abs(n.x));
  const thr = frontW * h.front + (1 - frontW) * (sideW * h.side + (1 - sideW) * h.back);
  return n.y > thr;
}
/** Lớp tóc ôm sát sọ theo đúng hình đầu, mép chân tóc gọn. */
function hairCap(kind: HeadKind, h: Hairline, push: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 96, 64);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = v3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    const inside = !hairMask(n, h);
    const s = headShape(n, kind, { smile: 0, frown: 0, open: 0 }, false)
      .multiplyScalar(HS * (inside ? 0.86 : push));
    pos.setXYZ(i, s.x, s.y, s.z);
  }
  g.computeVertexNormals();
  return g;
}
/** Các lọn tóc (khối nón) mọc theo hướng chải; gộp thành một mesh. */
function hairClumps(kind: HeadKind, h: Hairline, opts: { count: number; len: [number, number]; rad: [number, number]; fringe: number; sweep: number; messy: number; seed: number; minY?: number }): THREE.BufferGeometry {
  const r = rng(opts.seed);
  const geos: THREE.BufferGeometry[] = [];
  const n = v3();
  const up = v3(0, 1, 0);
  let tries = 0;
  while (geos.length < opts.count && tries++ < opts.count * 30) {
    n.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    if (n.lengthSq() > 1 || n.lengthSq() < 0.01) continue;
    n.normalize();
    if (!hairMask(n, h) || n.y < (opts.minY ?? -2)) continue;
    const p = headShape(n, kind, { smile: 0, frown: 0, open: 0 }, false).multiplyScalar(HS * 1.04);
    const normal = p.clone().normalize();
    const front = smooth(0.2, 0.8, n.z) * smooth(h.front + 0.25, h.front, n.y);
    // hướng chải: xuôi xuống, lệch sang một bên, phía trán rủ xuống thành mái
    const flow = v3(opts.sweep, -1, 0.35 * front * opts.fringe);
    flow.addScaledVector(v3(r() - 0.5, r() - 0.5, r() - 0.5), opts.messy);
    flow.addScaledVector(normal, -flow.dot(normal));
    if (flow.lengthSq() < 1e-4) flow.set(0, -1, 0);
    flow.normalize();
    // nằm áp theo da đầu (chỉ hơi vểnh), phía mái rủ xuống trán
    const dir = flow.multiplyScalar(0.9).addScaledVector(normal, -0.06 + 0.14 * opts.messy * r() + 0.1 * front).normalize();
    const len = opts.len[0] + r() * (opts.len[1] - opts.len[0]) + front * opts.fringe * 0.6;
    const rad = opts.rad[0] + r() * (opts.rad[1] - opts.rad[0]);
    const cone = new THREE.ConeGeometry(rad, len, 6, 1);
    cone.translate(0, len / 2, 0);
    cone.scale(1, 1, 0.38);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    cone.applyQuaternion(q);
    cone.translate(p.x - normal.x * 0.08, p.y - normal.y * 0.08, p.z - normal.z * 0.08);
    geos.push(cone);
  }
  const merged = mergeBufferGeometries(geos) ?? new THREE.BufferGeometry();
  geos.forEach((g) => g.dispose());
  return merged;
}

/* ================================================================== NHÂN VẬT */
export interface Character {
  group: THREE.Group;
  head: THREE.Group;
  readonly mood: Mood;
  setMood(m: Mood, dur: number, clock: number): void;
  setAuto(m: Mood): void;
  lookAt(w: V3): void;
  /**
   * Đưa điểm kẹp (giữa đầu ngón cái và ngón trỏ) của tay phải tới đúng w; null: thả về tư thế nghỉ.
   * tight: bám theo w ngay trong khung hình (khi đang cầm quân), không làm mượt.
   * curl: độ gập ngón (0.3 xòe để chuẩn bị nhặt, 0.7 kẹp chặt).
   * leanFor: nghiêng người sẵn đủ để với tới cả điểm này (đích sắp tới khi đang mang quân).
   */
  reach(w: V3 | null, opts?: { tight?: boolean; curl?: number; leanFor?: V3 }): void;
  /** Vị trí điểm kẹp quân của tay phải (thế giới). */
  handGrip(out: V3): V3;
  setUpperVisible(v: boolean): void;
  update(dt: number, t: number, viewer: V3 | null): void;
  dispose(): void;
}

interface Face {
  brow: number;
  browY: number;
  mouth: number;
  o: number;
  pitch: number;
  roll: number;
  lean: number;
}
const MOODS: Record<Mood, Face> = {
  idle: { brow: 0, browY: 0, mouth: 0.18, o: 0, pitch: 0.18, roll: 0, lean: 0.05 },
  thinking: { brow: 0.16, browY: -0.04, mouth: -0.15, o: 0, pitch: 0.3, roll: 0.12, lean: 0.12 },
  happy: { brow: -0.06, browY: 0.08, mouth: 0.95, o: 0.15, pitch: 0.02, roll: -0.05, lean: 0 },
  sad: { brow: -0.25, browY: 0.05, mouth: -0.8, o: 0, pitch: 0.42, roll: 0.06, lean: 0.14 },
  surprised: { brow: -0.04, browY: 0.22, mouth: 0, o: 1, pitch: -0.05, roll: 0, lean: -0.12 },
  wave: { brow: -0.05, browY: 0.08, mouth: 0.85, o: 0.1, pitch: -0.02, roll: -0.08, lean: 0 },
};

function segment(mat: THREE.Material, r0: number, r1: number, open = false): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 20, 1, open), mat);
  m.castShadow = true;
  return m;
}
const UP = v3(0, 1, 0);
const ZAX = v3(0, 0, 1);
function placeSegment(m: THREE.Object3D, a: V3, b: V3): void {
  const d = b.clone().sub(a);
  const len = d.length() || 0.0001;
  m.position.copy(a).addScaledVector(d, 0.5);
  m.scale.set(1, len, 1);
  m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
}
function solveIK(S: V3, target: V3, L1: number, L2: number, pole: V3): { E: V3; W: V3 } {
  const d = target.clone().sub(S);
  const dist = clamp(d.length(), Math.abs(L1 - L2) + 0.05, (L1 + L2) * 0.995);
  const dir = d.normalize();
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-6) p.set(0, -1, 0);
  p.normalize();
  return { E: S.clone().addScaledVector(dir, a).addScaledVector(p, h), W: S.clone().addScaledVector(dir, dist) };
}

interface Arm {
  up: THREE.Mesh;
  fo: THREE.Mesh;
  elbow: THREE.Mesh;
  cuff: THREE.Mesh | null;
  drape: THREE.Mesh | null;
  hand: Hand;
  cur: V3;
  curl: number;
  override: V3 | null;
  tight: boolean;
  holdCurl: number;
  leanFor: V3 | null;
  /** cổ tay - điểm kẹp (hệ tọa độ thân), đo lại mỗi khung để điểm kẹp tới đúng đích */
  off: V3 | null;
}

/** Nghiêng tối đa (rad) và độ nhổm khỏi ghế khi với quân ở xa. */
const LEAN_MAX = 1.0;
const RISE_Y = 1.4;
const RISE_Z = 0.8;
const riseOf = (lean: number) => smooth(0.5, 1.0, lean);
const L1 = 6.2; // bắp tay
const L2 = 5.4; // cẳng tay (tới cổ tay)

export function buildCharacter(id: AvatarId, bt: number): Character {
  const spec = CHAR_SPECS[id] ?? CHAR_SPECS.thusinh;
  const kind: HeadKind = spec.female
    ? { jaw: 0.24, browRidge: 0.025, nose: 0.8, chin: 0.03, lips: 1.15 }
    : { jaw: 0.18, browRidge: 0.045, nose: 1, chin: 0.035, lips: 1 };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.scale.setScalar(spec.scale);
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  const skinPhys = (map?: THREE.Texture) =>
    keep(new THREE.MeshPhysicalMaterial({ color: map ? 0xffffff : spec.skin, map: map ?? null, roughness: 0.55, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xff9c8a) }));
  const skinM = skinPhys();
  const nailM = keep(std(0xf1d3c8, { roughness: 0.25 }));
  const hairM = keep(std(spec.hair, { roughness: 0.48, metalness: 0.05 }));
  const hairShade = keep(std(new THREE.Color(spec.hair).multiplyScalar(0.8).getHex(), { roughness: 0.55 }));
  const robeM = keep(std(spec.robe, { roughness: 0.78 }));
  const bandM = keep(std(spec.band, { roughness: 0.7 }));
  const darkM = keep(std(0x1d1410, { roughness: 0.5 }));
  const chairM = keep(std(0x3a1a10, { roughness: 0.45 }));
  const metal = spec.hairStyle === 'general' || spec.hairStyle === 'lady' || spec.hairStyle === 'taoist';
  const crownM = keep(std(spec.crown, { roughness: 0.35, metalness: metal ? 0.6 : 0.1 }));
  const pantsM = keep(std(spec.pants, { roughness: 0.85 }));
  const modern = spec.outfit !== 'hanfu';

  // Ghế kiểu Minh
  body.add(mesh(new THREE.BoxGeometry(8.6, 0.8, 7.6), chairM, { pos: [0, -4.5, 0.6] }));
  for (const x of [-3.9, 3.9]) {
    body.add(mesh(new THREE.CylinderGeometry(0.32, 0.36, 15, 10), chairM, { pos: [x, -0.4, -2.9] }));
    body.add(mesh(new THREE.CylinderGeometry(0.32, 0.36, 11, 10), chairM, { pos: [x, -10.4, 4.1] }));
  }
  body.add(mesh(new THREE.BoxGeometry(2.6, 9.5, 0.3), chairM, { pos: [0, 1.6, -3.05], rot: [-0.08, 0, 0] }));
  body.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 10.4, 12), chairM, { pos: [0, 7.15, -2.95], rot: [0, 0, PI / 2] }));
  for (const s of [-1, 1]) body.add(mesh(new THREE.SphereGeometry(0.42, 10, 8), chairM, { pos: [s * 5.2, 7.25, -2.95] }));
  // Chân
  const legM = modern ? pantsM : robeM;
  for (const x of [-1.75, 1.75]) {
    const th = segment(legM, 1.5, 1.4);
    placeSegment(th, v3(x, -3.4, -0.2), v3(x, -3.6, 5.4));
    body.add(th);
    const sh = segment(legM, modern ? 1.15 : 1.5, modern ? 1.0 : 1.7);
    placeSegment(sh, v3(x, -3.7, 5.4), v3(x, FLOOR_Y + 1.1, 5.9));
    body.add(sh);
    body.add(mesh(new THREE.SphereGeometry(1.4, 14, 10), legM, { pos: [x, -3.6, 5.4] }));
    body.add(mesh(new THREE.BoxGeometry(1.6, 0.9, 3.0), modern ? keep(std(0xf2f2f0, { roughness: 0.6 })) : darkM, { pos: [x, FLOOR_Y + 0.45, 6.8] }));
  }

  // Thân trên
  const upper = new THREE.Group();
  upper.position.set(0, -2.2, 0);
  body.add(upper);
  const U = new THREE.Group();
  U.position.set(0, 2.2, 0);
  upper.add(U);
  const torsoMat = keep(std(0xffffff, { map: null, roughness: 0.8 }));
  const torsoTex = keep(torsoTexture(spec, () => (torsoMat.needsUpdate = true)));
  torsoMat.map = torsoTex;
  U.add(mesh(lathe(TORSO, 56), torsoMat, { scale: [1, 1, TORSO_Z], rot: [0, PI, 0] }));
  const shoulders = { R: v3(-3.5, 5.95, 0), L: v3(3.5, 5.95, 0) };
  for (const s of [shoulders.R, shoulders.L]) U.add(mesh(new THREE.SphereGeometry(1.0, 18, 12), robeM, { pos: [s.x * 0.96, s.y - 0.12, s.z], scale: [0.88, 0.72, 0.85] }));
  // cổ
  U.add(mesh(new THREE.CylinderGeometry(1.0, 1.15, 2.4, 20), skinM, { pos: [0, 7.95, -0.05] }));

  // Cổ áo theo trang phục
  if (spec.outfit === 'hanfu') {
    U.add(mesh(new THREE.TorusGeometry(1.1, 0.17, 8, 28), bandM, { pos: [0, 7.38, -0.05], rot: [PI / 2 - 0.2, 0, 0], scale: [1, 0.85, 1] }));
    U.add(mesh(new THREE.BoxGeometry(0.42, 1.7, 0.1), keep(std(spec.sash)), { pos: [0.7, -0.15, frontZ(0.7, 0.9) + 0.03], rot: [0, 0, 0.1] }));
  } else if (spec.outfit === 'polo') {
    U.add(mesh(new THREE.TorusGeometry(1.15, 0.16, 8, 28), bandM, { pos: [0, 7.4, -0.05], rot: [PI / 2 - 0.15, 0, 0] }));
    const flapM = keep(std(spec.band, { roughness: 0.7, side: THREE.DoubleSide }));
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(s * 0.18, 0.12);
      sh.lineTo(s * 1.12, 0.22);
      sh.lineTo(s * 0.62, -0.95);
      sh.closePath();
      U.add(mesh(new THREE.ShapeGeometry(sh), flapM, { pos: [0, 7.15, frontZ(0.6, 6.8) + 0.12], rot: [-0.42, 0, 0] }));
    }
    for (const y of [6.7, 6.0]) U.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), keep(std(0xffffff, { roughness: 0.3 })), { pos: [0, y, frontZ(0, y) + 0.03], rot: [PI / 2, 0, 0] }));
  } else {
    // cổ đứng của áo khoác
    const outer = keep(std(spec.robe, { roughness: 0.75, side: THREE.DoubleSide }));
    U.add(mesh(new THREE.CylinderGeometry(1.42, 1.52, 0.85, 28, 1, true, 0.35, PI * 2 - 0.7), outer, { pos: [0, 7.7, -0.05], rot: [0, PI, 0] }));
    if (spec.outfit === 'ptit') U.add(mesh(new THREE.CylinderGeometry(1.37, 1.47, 0.8, 28, 1, true, 0.35, PI * 2 - 0.7), keep(std(spec.band, { side: THREE.BackSide })), { pos: [0, 7.7, -0.05], rot: [0, PI, 0], noCast: true }));
    if (spec.outfit === 'hust') {
      // mũ trùm gấp sau gáy + dây rút
      U.add(mesh(new THREE.SphereGeometry(2.0, 24, 14, 0, PI * 2, 0, PI / 2), keep(std(spec.robe, { roughness: 0.75, side: THREE.DoubleSide })), { pos: [0, 7.6, -1.5], rot: [-1.35, 0, 0], scale: [1.05, 0.7, 0.6] }));
      U.add(mesh(new THREE.TorusGeometry(1.55, 0.18, 8, 24, PI), keep(std(0x1b2433)), { pos: [0, 8.3, -1.25], rot: [0.25, 0, 0], noCast: true }));
      for (const s of [-1, 1]) {
        U.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), darkM, { pos: [s * 0.55, 7.0, frontZ(0.55, 7.0) + 0.12] }));
        U.add(mesh(new THREE.CapsuleGeometry(0.11, 0.22, 4, 8), darkM, { pos: [s * 0.55, 6.3, frontZ(0.55, 6.3) + 0.15] }));
      }
    }
  }
  if (spec.armor) {
    const armM = keep(std(spec.armor, { roughness: 0.32, metalness: 0.75 }));
    for (const s of [shoulders.R, shoulders.L]) {
      U.add(mesh(new THREE.SphereGeometry(1.55, 18, 12, 0, PI * 2, 0, PI * 0.55), armM, { pos: [s.x * 1.05, s.y + 0.15, 0], scale: [1.05, 0.8, 1.05], rot: [0, 0, s.x > 0 ? -0.35 : 0.35] }));
      for (let k = 0; k < 3; k++) U.add(mesh(new THREE.TorusGeometry(1.2 - k * 0.05, 0.08, 6, 20, PI), armM, { pos: [s.x * 1.12, s.y - 0.6 - k * 0.45, 0], rot: [0, PI / 2, 0] }));
    }
    U.add(mesh(new THREE.CylinderGeometry(3.95, 3.85, 2.6, 40, 1, true, -PI * 0.5, PI), armM, { pos: [0, 4.6, 0], scale: [1, 1, TORSO_Z + 0.02] }));
    U.add(mesh(new THREE.SphereGeometry(0.75, 20, 14), keep(std(0xd8b25a, { roughness: 0.25, metalness: 0.9 })), { pos: [0, 4.6, frontZ(0, 4.6) + 0.15], scale: [1, 1, 0.35] }));
  }

  /* ----- Đầu */
  const head = new THREE.Group();
  head.position.set(0, 10.05, 0.2);
  U.add(head);
  const headGeo = keep(headGeometry(kind));
  const faceTex = keep(skinTexture(spec, kind));
  const faceMat = skinPhys(faceTex);
  const face = new THREE.Mesh(headGeo, faceMat);
  face.castShadow = true;
  head.add(face);
  // tai
  for (const s of [-1, 1]) {
    const p = headShape(v3(s, -0.08, -0.06).normalize(), kind, { smile: 0, frown: 0, open: 0 }).multiplyScalar(HS);
    const ear = new THREE.Group();
    ear.position.copy(p).add(v3(s * 0.05, 0, 0));
    ear.rotation.y = s * 0.35;
    ear.add(mesh(new THREE.SphereGeometry(1, 16, 12), skinM, { scale: [0.16, 0.5, 0.3] }));
    ear.add(mesh(new THREE.TorusGeometry(0.2, 0.055, 8, 16), skinM, { pos: [s * 0.08, 0.02, 0], rot: [0, PI / 2, 0], scale: [1, 1.7, 1] }));
    head.add(ear);
  }
  // mắt
  const eyeR = 0.118 * HS;
  const eyeTex = keep(eyeTexture(spec.age === 'old' ? '#3a2a1e' : '#3b2416'));
  const eyeMat = keep(new THREE.MeshPhysicalMaterial({ map: eyeTex, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const lidUpM = keep(std(0xffffff, { map: keep(lidTexture(spec, true)), roughness: 0.6 }));
  const lidLoM = keep(std(0xffffff, { map: keep(lidTexture(spec, false)), roughness: 0.6 }));
  const eyes: Array<{ ball: THREE.Mesh; up: THREE.Mesh; lo: THREE.Mesh }> = [];
  for (const s of [-1, 1]) {
    const surf = surfaceAt(0.32 * s, 0.02, kind);
    const g = new THREE.Group();
    g.position.set(surf.x, surf.y, surf.z - eyeR * 0.4);
    g.rotation.z = s * (spec.female ? 0.05 : 0.07);
    head.add(g);
    const ball = mesh(new THREE.SphereGeometry(eyeR, 24, 16), eyeMat, { noCast: true });
    g.add(ball);
    const up = mesh(new THREE.SphereGeometry(eyeR * 1.1, 24, 12, 0, PI * 2, 0, PI / 2), lidUpM, { noCast: true });
    const lo = mesh(new THREE.SphereGeometry(eyeR * 1.08, 24, 12, 0, PI * 2, PI / 2, PI / 2), lidLoM, { noCast: true });
    g.add(up, lo);
    eyes.push({ ball, up, lo });
  }
  // lông mày (nhiều sợi dẹt xếp theo cung mày)
  const brows: THREE.Group[] = [];
  const browM = spec.age === 'old' ? hairM : keep(std(new THREE.Color(spec.hair).lerp(new THREE.Color(spec.skin), 0.15).getHex(), { roughness: 0.7 }));
  for (const s of [-1, 1]) {
    const center = surfaceAt(0.32 * s, 0.25, kind);
    const bg = new THREE.Group();
    bg.position.copy(center);
    bg.userData.s = s;
    bg.userData.y = center.y;
    head.add(bg);
    const thick = spec.female ? 0.042 : spec.age === 'old' ? 0.08 : 0.06;
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const x = (0.15 + t * 0.34) * s;
      const y = 0.23 + Math.sin(t * PI * 0.85) * 0.045 - t * 0.025;
      const p = surfaceAt(x, y, kind).sub(center);
      p.z += 0.04;
      bg.add(mesh(new THREE.SphereGeometry(1, 8, 6), browM, { pos: [p.x, p.y, p.z], scale: [0.16, thick * (1 - t * 0.45), 0.05], rot: [0, 0, s * (0.15 - t * 0.35)], noCast: true }));
    }
    brows.push(bg);
  }
  // khoang miệng khi há
  const mouthPos = surfaceAt(0, -0.71, kind);
  const mouthIn = new THREE.Group();
  mouthIn.position.set(mouthPos.x, mouthPos.y, mouthPos.z - 0.02);
  mouthIn.add(mesh(new THREE.SphereGeometry(1, 16, 10), keep(std(0x3a1414, { roughness: 0.8 })), { scale: [0.3, 0.16, 0.05], noCast: true }));
  mouthIn.add(mesh(new THREE.BoxGeometry(0.42, 0.07, 0.05), keep(std(0xf2efe8, { roughness: 0.3 })), { pos: [0, 0.09, 0.02], noCast: true }));
  mouthIn.scale.setScalar(0.001);
  head.add(mouthIn);

  /* ----- Tóc */
  const hl: Record<HairStyle, Hairline> = {
    scholar: { front: 0.48, side: 0.12, back: -0.62 },
    lady: { front: 0.46, side: 0.0, back: -0.62 },
    elder: { front: 0.6, side: 0.15, back: -0.55 },
    general: { front: 0.5, side: 0.12, back: -0.6 },
    ponytail: { front: 0.46, side: 0.05, back: -0.6 },
    taoist: { front: 0.48, side: 0.12, back: -0.6 },
    messy: { front: 0.5, side: 0.12, back: -0.62 },
    neat: { front: 0.52, side: 0.15, back: -0.58 },
    bob: { front: 0.46, side: -0.1, back: -0.65 },
  };
  const line = hl[spec.hairStyle];
  head.add(mesh(keep(hairCap(kind, line, spec.hairStyle === 'elder' ? 1.02 : 1.035)), hairM));
  const addClumps = (o: Parameters<typeof hairClumps>[2], mat = hairM) => head.add(mesh(keep(hairClumps(kind, line, o)), mat));
  const knot = (y: number, z: number, r: number) => head.add(mesh(new THREE.SphereGeometry(r, 20, 14), hairM, { pos: [0, y, z], scale: [1, 0.9, 1] }));
  const longBack = (len: number, wide = 1.25) => head.add(mesh(new THREE.CapsuleGeometry(0.95, len, 6, 14), hairM, { pos: [0, -1.5 - len / 2, -1.55], scale: [wide, 1, 0.5], rot: [0.12, 0, 0] }));
  const pin = (y: number, z: number, len: number, mat: THREE.Material) => head.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 6), mat, { pos: [0, y, z], rot: [0, 0, PI / 2] }));
  const woodPin = keep(std(0x6b4a2b));
  switch (spec.hairStyle) {
    case 'scholar':
      addClumps({ count: 60, len: [0.4, 0.7], rad: [0.16, 0.24], fringe: 0, sweep: 0, messy: 0.1, seed: 3, minY: 0.2 }, hairShade);
      knot(2.55, -0.35, 0.72);
      head.add(mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.55, 18), crownM, { pos: [0, 2.8, -0.3] }));
      pin(2.85, -0.3, 2.4, keep(std(0xe8dcc0, { roughness: 0.3 })));
      longBack(4.5);
      break;
    case 'lady': {
      addClumps({ count: 70, len: [0.5, 0.9], rad: [0.16, 0.24], fringe: 0.4, sweep: 0, messy: 0.08, seed: 4, minY: 0.1 }, hairShade);
      head.add(mesh(new THREE.SphereGeometry(1.05, 18, 14), hairM, { pos: [0, 1.95, -1.25], scale: [1.25, 0.9, 1] }));
      for (const s of [-1, 1]) {
        head.add(mesh(new THREE.TorusGeometry(0.55, 0.26, 10, 20), hairM, { pos: [s * 1.15, 2.3, -0.85], rot: [0.2, s * 0.6, 0] }));
        head.add(mesh(new THREE.BoxGeometry(0.35, 2.6, 0.8), hairM, { pos: [s * 1.6, -0.9, 0.05] }));
      }
      const gold = keep(std(spec.crown, { roughness: 0.25, metalness: 0.85 }));
      head.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), gold, { pos: [0.9, 2.4, -1.0], rot: [0.3, 0, 1.1] }));
      for (let i = 0; i < 3; i++) {
        head.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6 + i * 0.2, 4), gold, { pos: [1.5 + i * 0.08, 1.75 - i * 0.2, -0.7], noCast: true }));
        head.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), keep(std(i === 1 ? 0xc0392b : 0xe9dcc0, { roughness: 0.3 })), { pos: [1.5 + i * 0.08, 1.45 - i * 0.3, -0.7], noCast: true }));
      }
      const fl = keep(std(spec.flower ?? 0xc0392b, { roughness: 0.6 }));
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * PI * 2;
        head.add(mesh(new THREE.SphereGeometry(0.17, 8, 6), fl, { pos: [-1.3 + Math.cos(a) * 0.2, 2.05 + Math.sin(a) * 0.2, -0.55], noCast: true }));
      }
      longBack(5.5);
      break;
    }
    case 'elder':
      knot(2.45, -0.45, 0.62);
      pin(2.5, -0.45, 2.0, woodPin);
      addClumps({ count: 40, len: [0.3, 0.6], rad: [0.12, 0.2], fringe: 0, sweep: 0, messy: 0.1, seed: 5, minY: -0.2 });
      break;
    case 'general': {
      addClumps({ count: 50, len: [0.4, 0.6], rad: [0.16, 0.22], fringe: 0, sweep: 0, messy: 0.06, seed: 6, minY: 0.2 }, hairShade);
      knot(2.55, -0.35, 0.72);
      head.add(mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.7, 6), crownM, { pos: [0, 2.82, -0.3] }));
      const rib = keep(std(0xa52a22, { roughness: 0.8 }));
      for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.22, 3.2, 0.06), rib, { pos: [s * 0.3, 0.9, -2.15], rot: [0.25, 0, s * 0.1] }));
      break;
    }
    case 'ponytail': {
      addClumps({ count: 60, len: [0.5, 0.8], rad: [0.15, 0.22], fringe: 0.5, sweep: 0.2, messy: 0.12, seed: 7, minY: 0.1 }, hairShade);
      knot(2.15, -1.3, 0.7);
      head.add(mesh(new THREE.CapsuleGeometry(0.55, 5.6, 6, 12), hairM, { pos: [0, -1.4, -2.75], rot: [0.2, 0, 0] }));
      const rb = keep(std(spec.crown, { roughness: 0.8 }));
      head.add(mesh(new THREE.TorusGeometry(0.45, 0.14, 8, 18), rb, { pos: [0, 1.8, -1.85], rot: [0.9, 0, 0] }));
      for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.2, 2.4, 0.05), rb, { pos: [s * 0.25, 0.6, -2.3], rot: [0.35, 0, s * 0.15] }));
      break;
    }
    case 'taoist': {
      addClumps({ count: 50, len: [0.4, 0.7], rad: [0.16, 0.22], fringe: 0, sweep: 0, messy: 0.08, seed: 8, minY: 0.2 }, hairShade);
      knot(2.5, -0.35, 0.72);
      const lotus = keep(std(spec.crown, { roughness: 0.3, metalness: 0.75 }));
      for (let q = 0; q < 6; q++) {
        const a = (q / 6) * PI * 2;
        head.add(mesh(new THREE.ConeGeometry(0.22, 0.75, 8), lotus, { pos: [Math.sin(a) * 0.42, 2.95, -0.35 + Math.cos(a) * 0.42], rot: [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4] }));
      }
      pin(2.8, -0.35, 2.3, woodPin);
      longBack(4.2);
      break;
    }
    case 'messy':
      // tóc ngắn dày, rối, mái rủ xuống trán (theo ảnh)
      addClumps({ count: 260, len: [0.6, 1.05], rad: [0.2, 0.3], fringe: 0.8, sweep: 0.15, messy: 0.5, seed: 11, minY: -0.35 });
      addClumps({ count: 110, len: [0.45, 0.8], rad: [0.18, 0.26], fringe: 0.6, sweep: -0.1, messy: 0.65, seed: 12, minY: 0.1 }, hairShade);
      break;
    case 'neat':
      addClumps({ count: 160, len: [0.45, 0.8], rad: [0.18, 0.26], fringe: 0.5, sweep: 0.55, messy: 0.15, seed: 13, minY: -0.3 });
      break;
    case 'bob': {
      addClumps({ count: 160, len: [0.6, 1.0], rad: [0.18, 0.26], fringe: 1.0, sweep: 0.05, messy: 0.12, seed: 14, minY: 0.0 });
      // tóc ngang vai: lớp vỏ rủ quanh hai bên và sau gáy, chừa khoảng trước mặt
      const prof: Array<[number, number]> = [
        [2.0, 0.8],
        [2.1, 0],
        [2.05, -1.2],
        [1.95, -2.2],
        [1.8, -2.9],
        [1.55, -3.1],
      ];
      const shell = new THREE.LatheGeometry(
        prof.map(([x, y]) => new THREE.Vector2(x, y)),
        40,
        PI * 0.28,
        PI * 2 - PI * 0.56,
      );
      head.add(mesh(keep(shell), keep(std(spec.hair, { roughness: 0.5, side: THREE.DoubleSide })), { pos: [0, 0, -0.15], scale: [0.86, 1, 1.0] }));
      break;
    }
  }
  if (spec.beard === 'long') {
    head.add(mesh(new THREE.SphereGeometry(1.0, 20, 16), hairM, { pos: [0, -3.0, 1.2], scale: [0.85, 1.9, 0.45], rot: [-0.25, 0, 0] }));
    const ch = surfaceAt(0, -0.95, kind);
    head.add(mesh(new THREE.SphereGeometry(0.85, 16, 12), hairM, { pos: [0, ch.y - 0.1, ch.z - 0.2], scale: [1.1, 0.75, 0.6] }));
    for (const s of [-1, 1]) {
      const m = surfaceAt(0.12 * s, -0.6, kind);
      head.add(mesh(new THREE.CapsuleGeometry(0.09, 0.9, 4, 8), hairM, { pos: [m.x + s * 0.35, m.y - 0.25, m.z + 0.05], rot: [0, 0, s * 0.75] }));
    }
  } else if (spec.beard === 'short') {
    for (const s of [-1, 1]) {
      const m = surfaceAt(0.11 * s, -0.6, kind);
      head.add(mesh(new THREE.CapsuleGeometry(0.06, 0.45, 4, 8), hairM, { pos: [m.x + s * 0.18, m.y - 0.05, m.z + 0.05], rot: [0, 0, s * 1.2] }));
    }
    const ch = surfaceAt(0, -1.0, kind);
    head.add(mesh(new THREE.ConeGeometry(0.22, 0.6, 10), hairM, { pos: [0, ch.y - 0.15, ch.z], rot: [PI - 0.4, 0, 0] }));
  } else if (spec.beard === 'goatee') {
    const ch = surfaceAt(0, -1.0, kind);
    head.add(mesh(new THREE.ConeGeometry(0.26, 1.1, 10), hairM, { pos: [0, ch.y - 0.35, ch.z - 0.05], rot: [PI - 0.35, 0, 0] }));
  }

  /* ----- Tay */
  const sleeveMat = (part: 'upper' | 'fore', k: 'R' | 'L', fallback: THREE.Material, side?: THREE.Side) => {
    const t = sleeveTexture(spec, part, k);
    if (!t) return fallback;
    keep(t);
    return keep(std(0xffffff, { map: t, roughness: 0.78, side: side ?? THREE.FrontSide }));
  };
  const arms = {} as Record<'R' | 'L', Arm>;
  for (const k of ['R', 'L'] as const) {
    let up: THREE.Mesh;
    let fo: THREE.Mesh;
    let elbow: THREE.Mesh;
    let cuff: THREE.Mesh | null = null;
    let drape: THREE.Mesh | null = null;
    if (spec.sleeve === 'wide' || spec.sleeve === 'narrow') {
      const wide = spec.sleeve === 'wide';
      up = segment(robeM, 0.95, 0.88);
      fo = segment(wide ? keep(std(spec.robe, { roughness: 0.8, side: THREE.DoubleSide })) : robeM, 0.9, wide ? 1.22 : 0.72, wide);
      elbow = mesh(new THREE.SphereGeometry(0.92, 12, 10), robeM);
      cuff = segment(keep(std(wide ? spec.band : 0x1d1410, { roughness: 0.6, side: THREE.DoubleSide })), wide ? 1.24 : 0.76, wide ? 1.25 : 0.76, true);
      if (wide) drape = mesh(new THREE.BoxGeometry(0.28, 1, 1), robeM);
    } else if (spec.sleeve === 'short') {
      up = segment(sleeveMat('upper', k, robeM), 1.05, 0.72);
      fo = segment(skinM, 0.66, 0.46);
      elbow = mesh(new THREE.SphereGeometry(0.7, 12, 10), skinM);
    } else {
      up = segment(sleeveMat('upper', k, robeM), 1.0, 0.85);
      fo = segment(sleeveMat('fore', k, robeM), 0.82, 0.66);
      elbow = mesh(new THREE.SphereGeometry(0.85, 12, 10), robeM);
      cuff = segment(keep(std(new THREE.Color(spec.robe).multiplyScalar(0.8).getHex(), { roughness: 0.8 })), 0.62, 0.58);
    }
    const hand = buildHand(skinM, nailM, k);
    body.add(up, fo, elbow, hand.group);
    if (cuff) body.add(cuff);
    if (drape) body.add(drape);
    arms[k] = { up, fo, elbow, cuff, drape, hand, cur: v3(k === 'R' ? -2.8 : 2.8, 0.6, 3.6), curl: 0.5, override: null, tight: false, holdCurl: 0.62, leanFor: null, off: null };
  }
  const wideSleeve = spec.sleeve === 'wide';

  const st = {
    mood: 'idle' as Mood,
    moodUntil: 0,
    auto: 'idle' as Mood,
    face: { ...MOODS.idle },
    look: v3(0, bt, 6),
    lookCur: v3(0, bt, 6),
    blinkAt: 2,
    blinkT: 0,
    glanceAt: 6,
    glanceUntil: 0,
    headYaw: 0,
    headPitch: 0,
    leanExtra: 0,
  };
  const tmp = v3();
  const yAx = v3();
  const xAx = v3();
  const basis = new THREE.Matrix4();

  /** Tư thế nghỉ (tọa độ cổ tay trong thân) + độ gập ngón. */
  const restHand = (k: 'R' | 'L', t: number): [V3, number] => {
    const s = k === 'R' ? -1 : 1;
    switch (st.mood) {
      case 'thinking':
        if (k === 'R') return [v3(-0.5, 6.0, 2.6), 0.85];
        break;
      case 'sad':
        return [v3(s * 2.0, 0.55, 3.2), 0.6];
      case 'surprised':
        return [v3(s * 3.8, 4.0, 3.6), 0.1];
      case 'wave':
        if (k === 'R') return [v3(-5.0 + Math.sin(t * 9) * 0.8, 10.5, 3.0), 0.05];
        break;
      case 'happy':
        return [v3(s * 2.4, 0.8 + Math.max(0, Math.sin(t * 7)) * 0.6, 3.6), 0.35];
      default:
        break;
    }
    // Đặt nhẹ tay lên mép bàn, ngón hơi khum (không che bàn cờ)
    return [v3(s * 2.7, 0.55, 3.45 + Math.sin(t * 0.7 + s) * 0.06), 0.5];
  };

  return {
    group: root,
    head,
    get mood() {
      return st.mood;
    },
    setMood(m, dur, clock) {
      st.mood = m;
      st.moodUntil = dur ? clock + dur : 0;
    },
    setAuto(m) {
      st.auto = m;
    },
    lookAt(w) {
      st.look.copy(w);
    },
    reach(w, opts) {
      const a = arms.R;
      if (!w) {
        a.override = null;
        a.off = null;
        a.tight = false;
        a.leanFor = null;
        return;
      }
      a.override = w.clone();
      a.tight = !!opts?.tight;
      a.holdCurl = opts?.curl ?? 0.62;
      a.leanFor = opts?.leanFor ? opts.leanFor.clone() : null;
    },
    handGrip(out) {
      return arms.R.hand.group.localToWorld(out.copy(arms.R.hand.grip));
    },
    setUpperVisible(v) {
      U.visible = v;
    },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) for (const mt of ([] as THREE.Material[]).concat(m.material)) mt.dispose();
      });
      for (const d of disposables) d.dispose();
    },
    update(dt, t, viewer) {
      if (st.moodUntil && t > st.moodUntil) {
        st.mood = st.auto;
        st.moodUntil = 0;
      }
      const target = MOODS[st.mood];
      const F = st.face;
      for (const key of Object.keys(target) as Array<keyof Face>) F[key] = damp(F[key], target[key], 7, dt);
      // mặt: morph target + khoang miệng
      const infl = face.morphTargetInfluences!;
      infl[0] = Math.max(0, F.mouth) * 0.9;
      infl[1] = Math.max(0, -F.mouth);
      infl[2] = F.o;
      mouthIn.scale.set(Math.max(0.001, 0.4 + F.o * 0.6), Math.max(0.001, F.o * 1.1), 1);
      mouthIn.position.y = mouthPos.y - F.o * 0.12;
      // chớp mắt: xoay mí trên xuống, mí dưới lên
      st.blinkT -= dt;
      if (t > st.blinkAt) {
        st.blinkT = 0.13;
        st.blinkAt = t + 2.4 + Math.random() * 3.6;
      }
      const blink = st.blinkT > 0 ? 1 : 0;
      const squint = st.mood === 'happy' || st.mood === 'wave' ? 0.35 : 0;
      const wideOpen = F.o * 0.25 + F.browY;
      for (const e of eyes) {
        const upTarget = blink ? 0.95 : -0.5 + squint * 0.45 - wideOpen;
        const loTarget = blink ? 0.25 : 0.6 - squint * 0.3 + wideOpen * 0.3;
        e.up.rotation.x = damp(e.up.rotation.x, upTarget, 35, dt);
        e.lo.rotation.x = damp(e.lo.rotation.x, loTarget, 35, dt);
      }
      for (const b of brows) {
        b.rotation.z = (b.userData.s as number) * (F.brow + spec.brow);
        b.position.y = (b.userData.y as number) + F.browY;
      }

      // nhìn bàn cờ, thỉnh thoảng nhìn người đối diện
      let lookW = st.look;
      if (viewer && (st.mood === 'idle' || st.mood === 'happy' || st.mood === 'wave')) {
        if (t > st.glanceAt) {
          st.glanceUntil = t + 1.3;
          st.glanceAt = t + 6 + Math.random() * 6;
        }
        if (t < st.glanceUntil || st.mood === 'wave') lookW = viewer;
      }
      st.lookCur.lerp(lookW, kf(5, dt));
      root.updateMatrixWorld(true);
      const local = U.worldToLocal(st.lookCur.clone()).sub(head.position);
      const yaw = clamp(Math.atan2(local.x, local.z), -0.7, 0.7);
      const pitch = clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.35, 0.6);
      st.headYaw = damp(st.headYaw, yaw * 0.75, 6, dt);
      st.headPitch = damp(st.headPitch, pitch * 0.55 + F.pitch * 0.5, 6, dt);
      head.rotation.set(st.headPitch, st.headYaw, F.roll + (st.mood === 'happy' ? Math.sin(t * 7) * 0.04 : 0));
      // mắt liếc theo phần còn lại
      for (const e of eyes) e.ball.rotation.set(clamp(pitch - st.headPitch, -0.35, 0.35), clamp(yaw - st.headYaw, -0.45, 0.45), 0);

      // nghiêng người khi với xa
      let need = 0;
      // vai (hệ thân) khi thân trên nghiêng một góc th quanh hông
      const shoulderAt = (sh: V3, th: number, out: V3): V3 => {
        const r = riseOf(th);
        const y = 2.2 + sh.y;
        return out.set(sh.x, -2.2 + r * RISE_Y + y * Math.cos(th) - sh.z * Math.sin(th), r * RISE_Z + y * Math.sin(th) + sh.z * Math.cos(th));
      };
      const wristGoal = (k: 'R' | 'L'): V3 | null => {
        const a = arms[k];
        if (!a.override) return null;
        const tgt = body.worldToLocal(a.override.clone());
        const S = body.worldToLocal(U.localToWorld(shoulders[k].clone()));
        const dh = v3(tgt.x - S.x, 0, tgt.z - S.z);
        if (dh.lengthSq() < 1e-4) dh.set(0, 0, 1);
        dh.normalize();
        // lần đầu: ước lượng (cổ tay lùi lại và cao hơn đầu ngón); sau đó dùng độ lệch đo được
        if (!a.off) a.off = dh.multiplyScalar(-2.1).add(v3(0, 0.65, 0));
        return tgt.add(a.off);
      };
      // Tìm góc nghiêng nhỏ nhất để cổ tay với tới đích (rất xa thì nhổm khỏi ghế), thay vì tăng dần theo phần thiếu.
      const goals: Array<[V3, V3]> = [];
      for (const k of ['R', 'L'] as const) {
        const g = wristGoal(k);
        if (!g) continue;
        goals.push([shoulders[k], g]);
        const lf = arms[k].leanFor;
        if (lf && arms[k].off) goals.push([shoulders[k], body.worldToLocal(lf.clone()).add(arms[k].off!)]);
      }
      if (goals.length) {
        need = 1;
        const reachMax = (L1 + L2) * 0.97;
        for (let th = F.lean; th <= LEAN_MAX + 1e-6; th += 0.02) {
          const ok = goals.every(([sh, g]) => shoulderAt(sh, th, tmp).distanceTo(g) <= reachMax);
          need = th - F.lean;
          if (ok) break;
        }
      }
      st.leanExtra = damp(st.leanExtra, need, arms.R.tight ? 12 : 6, dt);
      const lean = F.lean + st.leanExtra;
      const r = riseOf(lean);
      upper.rotation.x = lean + Math.sin(t * 1.6) * 0.008;
      upper.position.set(0, -2.2 + r * RISE_Y, r * RISE_Z);
      U.position.y = 2.2 + Math.sin(t * 1.6) * 0.05;
      upper.updateMatrixWorld(true);

      const pose = (k: 'R' | 'L'): V3 => {
        const a = arms[k];
        const S = body.worldToLocal(U.localToWorld(shoulders[k].clone()));
        const s = k === 'R' ? -1 : 1;
        // khuỷu tay buông xuống cạnh sườn (không chĩa ra sau)
        const { E, W } = solveIK(S, a.cur, L1, L2, a.override ? v3(s, -1.2, -0.5) : v3(s * 0.7, -1.6, -0.3));
        placeSegment(a.up, S, E);
        placeSegment(a.fo, E, W);
        a.elbow.position.copy(E);
        tmp.copy(W).sub(E).normalize();
        if (a.cuff) placeSegment(a.cuff, W.clone().addScaledVector(tmp, wideSleeve ? -0.45 : -0.55), W.clone().addScaledVector(tmp, 0.02));
        // hướng bàn tay: dọc theo cẳng tay, lòng bàn tay úp xuống (khi vẫy: ngửa về phía trước)
        const waving = st.mood === 'wave' && k === 'R' && !a.override;
        const palmUp = waving ? v3(0, 0, -1) : v3(0, 1, 0);
        // tay đặt trên bàn: bàn tay nằm gần như ngang mặt bàn dù cẳng tay hơi dốc
        const zAx = tmp.clone();
        if (!a.override && !waving && st.mood !== 'thinking' && st.mood !== 'surprised') {
          zAx.y = clamp(zAx.y, -0.25, 0.05);
          zAx.normalize();
        }
        yAx.copy(palmUp).addScaledVector(zAx, -palmUp.dot(zAx));
        if (yAx.lengthSq() < 0.02) yAx.set(0, 0, 1).addScaledVector(zAx, -zAx.z);
        yAx.normalize();
        xAx.crossVectors(yAx, zAx).normalize();
        basis.makeBasis(xAx, yAx, zAx);
        a.hand.group.quaternion.setFromRotationMatrix(basis);
        a.hand.group.position.copy(W).addScaledVector(tmp, wideSleeve ? 0.2 : 0.05);
        if (a.drape) {
          const mid = E.clone().lerp(W, 0.62);
          const h = clamp(mid.y - 0.15, 0.15, 2.4) * (1 - Math.min(1, Math.abs(tmp.y) * 1.2));
          const hor = v3(tmp.x, 0, tmp.z);
          if (hor.lengthSq() < 1e-4) hor.set(0, 0, 1);
          hor.normalize();
          a.drape.visible = h > 0.12;
          a.drape.scale.set(1, h, E.distanceTo(W) * 0.62);
          a.drape.position.set(mid.x, mid.y - h / 2 - 0.2, mid.z);
          a.drape.quaternion.setFromUnitVectors(ZAX, hor);
        }
        return W;
      };
      for (const k of ['R', 'L'] as const) {
        const a = arms[k];
        const wg = wristGoal(k);
        let goal: V3;
        let curl: number;
        if (wg) {
          goal = wg;
          curl = a.holdCurl;
        } else [goal, curl] = restHand(k, t);
        if (wg && a.tight) a.cur.copy(goal);
        else a.cur.lerp(goal, kf(a.override ? 9 : 6, dt));
        a.curl = damp(a.curl, curl, a.tight ? 14 : 8, dt);
        a.hand.setCurl(a.curl);
        let W = pose(k);
        if (a.override && a.off) {
          // đo lại cổ tay - điểm kẹp; khi bám chặt thì giải lại ngay để đầu ngón trùng quân trong khung này
          const tgtL = body.worldToLocal(a.override.clone());
          for (let it = 0; it < (a.tight ? 2 : 1); it++) {
            a.hand.group.updateWorldMatrix(true, false);
            const gripL = body.worldToLocal(a.hand.group.localToWorld(a.hand.grip.clone()));
            a.off.lerp(W.clone().sub(gripL), a.tight ? 1 : 0.5);
            if (!a.tight) break;
            a.cur.copy(tgtL).add(a.off);
            W = pose(k);
          }
        }
      }
    },
  };
}
