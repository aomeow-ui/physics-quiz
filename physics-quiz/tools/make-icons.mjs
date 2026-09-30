/**
 * 生成 PWA 图标（纯 Node，无依赖）
 * 手写 PNG 编码器 + 3× 超采样抗锯齿，绘制一个「原子」图形。
 * 用法：node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ----------------------------------------------------------- PNG 编码 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ----------------------------------------------------------- 图形绘制 */
const BG_TOP = [20, 48, 105];
const BG_BOT = [47, 122, 222];
const FG = [255, 255, 255];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const ORBITS = [-Math.PI / 3, 0, Math.PI / 3];
const ELECTRON_ANGLE = [0.85, 2.55, 4.35];

/** 返回某采样点的白色覆盖强度 0..1 */
function symbolCoverage(u, v, k) {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const a = 0.335 * k;
  const b = 0.142 * k;
  const ring = 0.085;          // 归一化距离半宽
  const nucleus = 0.072 * k;
  const dot = 0.042 * k;

  let cover = 0;

  // 三条轨道
  for (let i = 0; i < ORBITS.length; i++) {
    const t = ORBITS[i];
    const ct = Math.cos(t), st = Math.sin(t);
    const ru = dx * ct + dy * st;
    const rv = -dx * st + dy * ct;
    const d = Math.sqrt((ru / a) * (ru / a) + (rv / b) * (rv / b));
    if (Math.abs(d - 1) < ring) cover = Math.max(cover, 1);
  }

  // 原子核
  if (Math.sqrt(dx * dx + dy * dy) < nucleus) cover = 1;

  // 轨道上的电子
  for (let i = 0; i < ORBITS.length; i++) {
    const t = ORBITS[i];
    const q = ELECTRON_ANGLE[i];
    const px = a * Math.cos(q) * Math.cos(t) - b * Math.sin(q) * Math.sin(t);
    const py = a * Math.cos(q) * Math.sin(t) + b * Math.sin(q) * Math.cos(t);
    const ex = dx - px, ey = dy - py;
    if (Math.sqrt(ex * ex + ey * ey) < dot) cover = 1;
  }

  return cover;
}

function samplePixel(u, v, k) {
  const base = mix(BG_TOP, BG_BOT, Math.min(1, Math.max(0, v)));
  const c = symbolCoverage(u, v, k);
  const out = mix(base, FG, c);
  return [out[0], out[1], out[2], 1];
}

function makeIcon(size, k) {
  const SS = 3;
  const rgba = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = samplePixel(u, v, k);
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePNG(size, size, rgba);
}

/* ----------------------------------------------------------- 输出 */
const outDir = join(ROOT, 'icons');
mkdirSync(outDir, { recursive: true });

const jobs = [
  ['icon-192.png', 192, 1.0],
  ['icon-512.png', 512, 1.0],
  ['icon-512-maskable.png', 512, 0.68],   // 遮罩安全区：图形缩小
  ['apple-touch-icon.png', 180, 1.0],
  ['favicon.png', 64, 1.0]
];

for (const [name, size, k] of jobs) {
  const buf = makeIcon(size, k);
  writeFileSync(join(outDir, name), buf);
  console.log(`  ${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log('图标已生成到 icons/');
