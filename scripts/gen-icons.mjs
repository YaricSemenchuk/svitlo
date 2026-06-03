// Генерує прості PNG-іконки (лаймовий знак на майже-чорному) без зовнішніх залежностей.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const OUT = new URL('../public/icons/', import.meta.url)
mkdirSync(OUT, { recursive: true })

const BG = [8, 8, 10]
const LIME = [200, 255, 61]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // rows with filter byte 0
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw)
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Малюємо: фон, лаймовий «S»-подібний знак (дві смуги + крапка-авто).
function draw(size, { padding = 0.18 } = {}) {
  const buf = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    buf[i] = r
    buf[i + 1] = g
    buf[i + 2] = b
    buf[i + 3] = a
  }
  // фон
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, BG)

  const p = size * padding
  const inner = size - p * 2
  // три лаймові горизонтальні смуги (стилізована «S» / дорога)
  const barH = inner * 0.16
  const gaps = [0, 0.42, 0.84]
  for (const g of gaps) {
    const yTop = Math.round(p + g * inner * 1.0)
    for (let yy = 0; yy < barH; yy++) {
      const y = yTop + yy
      // зміщення смуг для S-форми
      const off = g === 0.42 ? inner * 0.18 : 0
      for (let xx = 0; xx < inner - inner * 0.18; xx++) {
        set(Math.round(p + off + xx), y, LIME)
      }
    }
  }
  return buf
}

function write(name, size) {
  writeFileSync(new URL(name, OUT), png(size, size, draw(size)))
  console.log('wrote', name, size)
}

write('icon-192.png', 192)
write('icon-512.png', 512)
write('maskable-512.png', 512) // те саме зображення з безпечним padding
write('apple-touch-icon.png', 180)
