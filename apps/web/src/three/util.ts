/** Tiện ích dùng chung cho cảnh 3D. */
import * as THREE from 'three';

export type V3 = THREE.Vector3;
export const PI = Math.PI;
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const kf = (k: number, dt: number) => 1 - Math.exp(-k * dt);
export const damp = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * kf(k, dt);
export const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
export const hexCss = (n: number) => '#' + ('000000' + n.toString(16)).slice(-6);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function rng(seed: number): () => number {
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

export function std(color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...o });
}

export interface MeshOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  noCast?: boolean;
  receive?: boolean;
}
export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, o: MeshOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = !o.noCast;
  m.receiveShadow = !!o.receive;
  if (o.pos) m.position.set(...o.pos);
  if (o.rot) m.rotation.set(...o.rot);
  if (o.scale) m.scale.set(...o.scale);
  return m;
}
export function lathe(pts: Array<[number, number]>, seg = 32): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    seg,
  );
}
export function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.encoding = THREE.sRGBEncoding;
  return t;
}
export function canvas2d(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

let logoImg: HTMLImageElement | null = null;
let logoReady: Promise<HTMLImageElement | null> | null = null;
/** Logo ANT GROUP (public/river-logo.jpg, 1280×1280 nền trắng). */
export function loadAntLogo(): Promise<HTMLImageElement | null> {
  logoReady ??= new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      logoImg = img;
      res(img);
    };
    img.onerror = () => res(null);
    img.src = '/river-logo.jpg';
  });
  return logoReady;
}
export const antLogo = () => logoImg;
/** Vùng cắt trong ảnh logo: biểu tượng và chữ. */
export const LOGO_ICON = [340, 280, 600, 485] as const;
export const LOGO_TEXT = [105, 865, 1070, 140] as const;
