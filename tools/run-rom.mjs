#!/usr/bin/env node
// Headless check: run a ROM for N frames and save the screen as a PNG.
// A .gg file runs as a Game Gear. Buttons can be pressed from a frame on:
// "start@120" holds Start/Pause from frame 120 for 10 frames (also: 1, 2, up,
// down, left, right).
//
//   node tools/run-rom.mjs <rom> [frames=600] [out.png] [button@frame ...]

import fs from 'node:fs';
import zlib from 'node:zlib';
import { MasterSystem } from '../src/emu/sms.js';

const [file, framesArg = '600', out = 'out/screen.png', ...presses] = process.argv.slice(2);
if (!file) { console.error('usage: node tools/run-rom.mjs <rom> [frames] [out.png] [button@frame ...]'); process.exit(1); }
const BITS = { right: 1, left: 2, up: 4, down: 8, 2: 0x10, 1: 0x20, start: 0x80 };
const plan = presses.map((p) => { const [b, f] = p.split('@'); return { bit: BITS[b], from: +f }; });

const m = new MasterSystem();
m.load(new Uint8Array(fs.readFileSync(file)), { gg: /\.gg$/i.test(file) });
const frames = +framesArg, t0 = performance.now();
for (let f = 0; f < frames; f++) {
  m.buttons = plan.reduce((b, p) => b | (f >= p.from && f < p.from + 10 ? p.bit : 0), 0);
  m.runFrame();
}
const ms = (performance.now() - t0) / frames;
console.log(`${file}: ${m.cart.console}, ${m.cart.name}, ${frames} frames, ${ms.toFixed(2)} ms a frame`);

// PNG: RGBA rows, each with a filter byte of 0.
const w = m.width, h = m.height, raw = Buffer.alloc((w * 4 + 1) * h);
for (let y = 0; y < h; y++) {
  raw[y * (w * 4 + 1)] = 0;
  for (let x = 0; x < w; x++) {
    const v = m.frame[y * w + x], o = y * (w * 4 + 1) + 1 + x * 4;
    raw[o] = v & 0xFF; raw[o + 1] = (v >> 8) & 0xFF; raw[o + 2] = (v >> 16) & 0xFF; raw[o + 3] = 0xFF;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.mkdirSync(out.replace(/[^/]*$/, '') || '.', { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`saved ${out} (${w}x${h})`);
