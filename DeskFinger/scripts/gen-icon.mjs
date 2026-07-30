// 生成 src-tauri/icons/icon.png：圆角渐变底 + 白色指针箭头（DeskFinger）
// 纯 Node 实现，无第三方依赖：手写 PNG 编码（zlib 来自 Node 内置）。
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const S = 1024; // 输出尺寸
const SS = 2; // 超采样抗锯齿
const W = S * SS;

// 圆角矩形参数
const R = 224 * SS;
// 指针箭头多边形（经典光标形状）
const POLY = [
  [380, 190],
  [380, 780],
  [500, 622],
  [590, 846],
  [668, 806],
  [580, 586],
  [776, 586],
].map(([x, y]) => [x * SS, y * SS]);

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 渐变两端色：#6e8bff -> #9b6dff
const C1 = [0x6e, 0x8b, 0xff];
const C2 = [0x9b, 0x6d, 0xff];

function insideRoundedRect(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= W) return false;
  const cx = Math.min(x, W - 1 - x);
  const cy = Math.min(y, W - 1 - y);
  if (cx >= R || cy >= R) return true;
  const dx = R - cx;
  const dy = R - cy;
  return dx * dx + dy * dy <= R * R;
}

function insidePoly(x, y) {
  let inside = false;
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [xi, yi] = POLY[i];
    const [xj, yj] = POLY[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// 渲染 RGBA 像素
const raw = Buffer.alloc(W * (W * 4 + 1));
for (let y = 0; y < W; y++) {
  const rowStart = y * (W * 4 + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    // 2x2 超采样
    let a = 0;
    let r = 0,
      g = 0,
      b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + sx / SS;
        const py = y + sy / SS;
        if (!insideRoundedRect(px, py)) continue;
        a++;
        if (insidePoly(px, py)) {
          r += 255;
          g += 255;
          b += 255;
        } else {
          const t = (px + py) / (2 * W);
          r += lerp(C1[0], C2[0], t);
          g += lerp(C1[1], C2[1], t);
          b += lerp(C1[2], C2[2], t);
        }
      }
    }
    const n = SS * SS;
    const o = rowStart + 1 + x * 4;
    if (a === 0) {
      raw[o + 3] = 0;
    } else {
      raw[o] = Math.round(r / a);
      raw[o + 1] = Math.round(g / a);
      raw[o + 2] = Math.round(b / a);
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
}

// ---- PNG 编码 ----
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.resolve("src-tauri/icons");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.png"), png);
console.log(`icon.png written: ${W}x${W}, ${png.length} bytes`);
