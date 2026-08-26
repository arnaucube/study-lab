#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function onStroke(x, y, points, radius) {
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(x, y, ...points[index - 1], ...points[index]) <= radius) return true;
  }
  return false;
}

function sample(x, y, maskable) {
  const paper = [248, 247, 242];
  const sage = [79, 109, 96];
  const ink = [24, 32, 29];
  const orange = [233, 133, 87];
  let color = maskable ? sage : paper;
  const blob = ((x - 256) / 162) ** 2 + ((y - 258) / 181) ** 2 <= 1;
  if (blob) color = ink;

  const sPath = [
    [330, 171], [309, 150], [270, 143], [228, 151], [201, 175], [195, 204],
    [205, 229], [235, 246], [278, 260], [310, 277], [320, 304], [314, 335],
    [287, 361], [245, 369], [207, 358], [184, 335]
  ];
  if (blob && onStroke(x, y, sPath, 24)) color = paper;
  if ((x - 379) ** 2 + (y - 137) ** 2 <= 30 ** 2) color = orange;
  return color;
}

function render(size, maskable = false) {
  const rows = [];
  const samples = 2;
  for (let py = 0; py < size; py += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px += 1) {
      const total = [0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const color = sample((px + (sx + 0.5) / samples) * 512 / size, (py + (sy + 0.5) / samples) * 512 / size, maskable);
          total[0] += color[0]; total[1] += color[1]; total[2] += color[2];
        }
      }
      const offset = 1 + px * 4;
      row[offset] = Math.round(total[0] / (samples * samples));
      row[offset + 1] = Math.round(total[1] / (samples * samples));
      row[offset + 2] = Math.round(total[2] / (samples * samples));
      row[offset + 3] = 255;
    }
    rows.push(row);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return png;
}

const outputs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false]
];

for (const [filename, size, maskable] of outputs) {
  fs.writeFileSync(path.join(root, 'icons', filename), render(size, maskable));
}
