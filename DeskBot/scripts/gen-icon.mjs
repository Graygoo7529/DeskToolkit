// 生成占位像素图标：src-tauri/icons/icon.png (256x256) 与 tray.png (32x32)
// 无第三方依赖：自带最小 PNG 编码器（zlib 来自 node 内置）
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'src-tauri', 'icons')
fs.mkdirSync(outDir, { recursive: true })

// ---- 最小 PNG 编码 ----
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- 16x16 像素机器人头 ----
// . 透明  # 深色描边  B 机身青色  E 眼睛  W 眼睛高光  C 腮红  A 天线
const MAP = [
  '.......A........',
  '.......A........',
  '......AAA.......',
  '..###########...',
  '.#BBBBBBBBBBB#..',
  '.#BEEBBBBWEEB#..',
  '.#BEWBBBBBEEB#..',
  '.#BBBBBBBBBBB#..',
  '.#CBBB###BBBC#..',
  '.#CBBBBBBB#BC#..',
  '.#BBBBBBBBBBB#..',
  '..###########...',
  '....#B#..#B#....',
  '....###..###....',
  '................',
  '................',
]
const PALETTE = {
  '#': [19, 78, 74, 255],
  B: [94, 234, 212, 255],
  E: [15, 23, 42, 255],
  W: [255, 255, 255, 255],
  C: [251, 113, 133, 255],
  A: [251, 191, 36, 255],
  '.': [0, 0, 0, 0],
}

function render(size) {
  const scale = size / 16
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ch = MAP[Math.floor(y / scale)][Math.floor(x / scale)]
      const [r, g, b, a] = PALETTE[ch] ?? PALETTE['.']
      const i = (y * size + x) * 4
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a
    }
  }
  return rgba
}

// ---- ICO（Windows 资源必须用 .ico；256x256 PNG payload）----
// ICONDIR 6B + ICONDIRENTRY 16B：宽/高写 0 表示 256
function encodeICO(png) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // count
  header.writeUInt8(0, 6) // width 0 = 256
  header.writeUInt8(0, 7) // height 0 = 256
  header.writeUInt8(0, 8) // color count
  header.writeUInt8(0, 9) // reserved
  header.writeUInt16LE(1, 10) // planes
  header.writeUInt16LE(32, 12) // bit count
  header.writeUInt32LE(png.length, 14) // dwBytesInRes
  header.writeUInt32LE(22, 18) // dwImageOffset
  return Buffer.concat([header, png])
}

const iconPng = encodePNG(256, render(256))
fs.writeFileSync(path.join(outDir, 'icon.png'), iconPng)
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(iconPng))
fs.writeFileSync(path.join(outDir, 'tray.png'), encodePNG(32, render(32)))
console.log('icons written to', outDir)
