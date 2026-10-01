// 生成 1024x1024 主图标：圆角矩形渐变底 + 白色圆环 + 高光点
import zlib from 'node:zlib'
import fs from 'node:fs'

const S = 1024
const R = 220 // 圆角半径

function rrectSDF(x, y) {
  const qx = Math.abs(x - S / 2) - (S / 2 - R)
  const qy = Math.abs(y - S / 2) - (S / 2 - R)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - R
}

const px = Buffer.alloc(S * S * 4)
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    const d = rrectSDF(x, y)
    const alpha = Math.min(1, Math.max(0, 0.5 - d))
    // 对角渐变：indigo -> cyan
    const t = (x + y) / (2 * S)
    const r = 99 + (34 - 99) * t
    const g = 102 + (211 - 102) * t
    const b = 241 + (238 - 241) * t
    // 白色圆环
    const dist = Math.hypot(x - S / 2, y - S / 2)
    const ring = Math.abs(dist - 300) < 36
    // 环上高光点（右上角）
    const dot = Math.hypot(x - (S / 2 + 212), y - (S / 2 - 212)) < 64
    const inner = dist < 200 // 中心实心圆
    let cr = r,
      cg = g,
      cb = b
    if (ring || dot || inner) {
      const mix = inner ? 0.92 : 1
      cr = cr * (1 - mix) + 255 * mix
      cg = cg * (1 - mix) + 255 * mix
      cb = cb * (1 - mix) + 255 * mix
    }
    px[i] = Math.round(cr)
    px[i + 1] = Math.round(cg)
    px[i + 2] = Math.round(cb)
    px[i + 3] = Math.round(alpha * 255)
  }
}

// --- PNG 编码 ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
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

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA

const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

fs.mkdirSync('src-tauri/icons', { recursive: true })
fs.writeFileSync('src-tauri/icons/app-icon.png', png)
console.log('written src-tauri/icons/app-icon.png', png.length, 'bytes')
