// The Master System / Game Gear video chip (VDP), in its Mode 4: a 32x28
// tile background that scrolls both ways, and 64 sprites (8 a line), drawn a
// scanline at a time so mid-frame scroll changes (status bars, parallax) show.
//
// 16 KB of video RAM for tiles (4 bits a pixel, as four bitplanes, 32 bytes a
// tile), the name table and the sprite table; color RAM holds 32 colors (16 for
// the background, 16 shared by the background and the sprites): 6-bit RGB on
// the Master System, 12-bit on the Game Gear, which shows only the 160x144
// middle of the 256x192 picture.
//
// Ports: data (BE) reads and writes video or color RAM through an
// auto-incrementing address; control (BF) takes two bytes (an address, or a
// register write) and reads back the status: frame interrupt, sprite overflow,
// sprite collision. Registers:
//   0  bit 1/2 mode, 3 sprites shifted left 8, 4 line interrupt on, 5 blank the
//      left column, 6 top two rows don't scroll sideways, 7 right 8 columns
//      don't scroll vertically
//   1  bit 0 sprites doubled, 1 tall (8x16) sprites, 5 frame interrupt on, 6 display on
//   2  name table, 5 sprite table, 6 sprite tiles (bit 2: the second 256),
//   7  backdrop (a sprite-palette color), 8 horizontal scroll, 9 vertical scroll,
//   10 line interrupt period
//
// Interrupts: the frame interrupt at the start of the line after the picture;
// the line interrupt each time a counter, reloaded from register 10 outside
// the picture, runs out while the picture is drawn.

import { capture, apply } from './state.js';

export const LINES = 262;
const STATE = ['vram', 'cram', 'regs', 'addr', 'code', 'latch', 'first', 'buffer', 'status', 'lineCounter', 'lineIrq', 'line', 'vscroll', 'ggLatch'];

export class VDP {
  saveState() { return capture(this, STATE); }
  loadState(s) { apply(this, STATE, s); this.colors.fill(0); this.refreshColors(); }

  constructor(gg) {
    this.gg = gg;
    this.width = gg ? 160 : 256;
    this.height = gg ? 144 : 192;
    this.frame = new Uint32Array(this.width * this.height);
    this.colors = new Uint32Array(32);       // color RAM as RGBA
    this.lineBuf = new Uint8Array(256);      // palette indices for the line being drawn
    this.bgPri = new Uint8Array(256);        // background pixels drawn over sprites
    this.spriteHit = new Uint8Array(256);
    this.reset();
  }

  reset() {
    this.vram = new Uint8Array(0x4000);
    this.cram = new Uint8Array(this.gg ? 64 : 32);
    this.regs = new Uint8Array(16);
    this.regs[2] = 0x0E; this.regs[5] = 0x7E; this.regs[10] = 0xFF;
    this.addr = 0; this.code = 0; this.latch = 0; this.first = true; this.buffer = 0;
    this.status = 0; this.lineCounter = 0xFF; this.lineIrq = false; this.line = 0; this.vscroll = 0;
    this.ggLatch = 0;
    this.colors.fill(0xFF000000);
  }

  get irq() { return ((this.status & 0x80) && (this.regs[1] & 0x20)) || (this.lineIrq && (this.regs[0] & 0x10)); }

  // ---------------------------------------------------------------- ports

  readData() {
    this.first = true;
    const v = this.buffer;
    this.buffer = this.vram[this.addr];
    this.addr = (this.addr + 1) & 0x3FFF;
    return v;
  }

  writeData(v) {
    this.first = true;
    if (this.code === 3) {
      if (this.gg) {
        // Game Gear colors are two bytes: the even one is held until the odd one completes it.
        const a = this.addr & 0x3F;
        if (!(a & 1)) this.ggLatch = v;
        else { this.cram[a - 1] = this.ggLatch; this.cram[a] = v & 0x0F; this.setColor(a >> 1); }
      } else {
        const a = this.addr & 0x1F;
        this.cram[a] = v & 0x3F;
        this.setColor(a);
      }
    } else this.vram[this.addr] = v;
    this.buffer = v;
    this.addr = (this.addr + 1) & 0x3FFF;
  }

  readStatus() {
    const v = this.status | 0x1F;
    this.status = 0;
    this.lineIrq = false;
    this.first = true;
    return v;
  }

  writeControl(v) {
    if (this.first) {
      this.latch = v;
      this.addr = (this.addr & 0x3F00) | v;
      this.first = false;
      return;
    }
    this.first = true;
    this.code = v >> 6;
    this.addr = ((v & 0x3F) << 8) | this.latch;
    if (this.code === 0) { this.buffer = this.vram[this.addr]; this.addr = (this.addr + 1) & 0x3FFF; }
    else if (this.code === 2) this.regs[v & 0x0F] = this.latch;
  }

  // The vertical counter as games read it: 00-DA, then jumping back to D5-FF.
  vcounter() { const l = this.line; return l <= 0xDA ? l : l - 6; }

  setColor(i) {
    let r, g, b;
    if (this.gg) {
      const v = this.cram[i * 2] | (this.cram[i * 2 + 1] << 8);
      r = (v & 15) * 17; g = ((v >> 4) & 15) * 17; b = ((v >> 8) & 15) * 17;
    } else {
      const v = this.cram[i];
      r = (v & 3) * 85; g = ((v >> 2) & 3) * 85; b = ((v >> 4) & 3) * 85;
    }
    this.colors[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
  }
  refreshColors() { for (let i = 0; i < 32; i++) this.setColor(i); }

  // ---------------------------------------------------------------- timing

  // At the start of each line: the frame interrupt, and the vertical scroll taken for the frame.
  startLine(line) {
    this.line = line;
    if (line === 0) this.vscroll = this.regs[9];
    if (line === 193) this.status |= 0x80;
  }

  // Where the picture ends on each line (the line interrupt counter runs here).
  endActive(line) {
    if (line <= 192) {
      if (--this.lineCounter < 0) { this.lineCounter = this.regs[10]; this.lineIrq = true; }
    } else this.lineCounter = this.regs[10];
  }

  // ---------------------------------------------------------------- drawing

  renderLine(y) {
    if (y >= 192) return;
    const gg = this.gg;
    if (gg && (y < 24 || y >= 168)) { this.spriteScan(y); return; }   // off the Game Gear's screen: sprites still count
    const R = this.regs, out = this.lineBuf, pri = this.bgPri;
    const backdrop = 16 + (R[7] & 15);
    if (!(R[1] & 0x40)) { out.fill(backdrop); this.emit(y); return; }
    // Background.
    const vram = this.vram, nt = (R[2] & 0x0E) << 10;
    const hs = (R[0] & 0x40) && y < 16 ? 0 : R[8];
    for (let col = 0; col < 32; col++) {
      const vs = (R[0] & 0x80) && col >= 24 ? 0 : this.vscroll;
      const row = (y + vs) % 224, tileRow = row >> 3;
      const e = nt + ((tileRow * 32 + col) << 1);
      const lo = vram[e], hi = vram[e + 1];
      const tile = lo | ((hi & 1) << 8), hflip = hi & 2, vflip = hi & 4, pal = (hi & 8) << 1, front = hi & 0x10;
      const py = vflip ? 7 - (row & 7) : row & 7;
      const p = tile * 32 + py * 4;
      const b0 = vram[p], b1 = vram[p + 1], b2 = vram[p + 2], b3 = vram[p + 3];
      for (let px = 0; px < 8; px++) {
        const bit = hflip ? px : 7 - px;
        const c = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
        const x = (col * 8 + px + hs) & 255;
        out[x] = pal | c;
        pri[x] = front && c ? 1 : 0;
      }
    }
    this.sprites(y, out, pri);
    if (R[0] & 0x20) for (let x = 0; x < 8; x++) out[x] = backdrop;   // the blanked left column
    this.emit(y);
  }

  // The sprites on line y: their pixels over the background (unless it has priority), at most 8.
  sprites(y, out, pri) {
    const R = this.regs, vram = this.vram, sat = (R[5] & 0x7E) << 7;
    const tall = R[1] & 2, zoom = R[1] & 1 ? 2 : 1, h = (tall ? 16 : 8) * zoom;
    const base = R[6] & 4 ? 256 : 0, shift = R[0] & 8 ? 8 : 0;
    const hit = this.spriteHit;
    hit.fill(0);
    let n = 0;
    for (let i = 0; i < 64; i++) {
      const sy = vram[sat + i];
      if (sy === 0xD0) break;                          // the end of the list
      const top = sy >= 0xF0 ? sy - 256 + 1 : sy + 1;  // y of 240 and up wraps to the top
      if (y < top || y >= top + h) continue;
      if (++n > 8) { this.status |= 0x40; break; }
      const sx = vram[sat + 0x80 + i * 2] - shift;
      let tile = vram[sat + 0x81 + i * 2];
      if (tall) tile &= 0xFE;
      const line = Math.floor((y - top) / zoom);
      const p = (base + tile) * 32 + line * 4;
      const b0 = vram[p], b1 = vram[p + 1], b2 = vram[p + 2], b3 = vram[p + 3];
      for (let px = 0; px < 8 * zoom; px++) {
        const x = sx + px;
        if (x < 0 || x > 255) continue;
        const bit = 7 - Math.floor(px / zoom);
        const c = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
        if (!c) continue;
        if (hit[x]) { this.status |= 0x20; continue; }  // two sprites overlap: the first one listed stays in front
        hit[x] = 1;
        if (!pri[x]) out[x] = 16 | c;
      }
    }
  }

  // Off-screen lines still set the sprite overflow and collision flags.
  spriteScan(y) {
    if (!(this.regs[1] & 0x40)) return;
    this.bgPri.fill(0);
    this.sprites(y, this.lineBuf, this.bgPri);
  }

  emit(y) {
    const colors = this.colors, out = this.lineBuf, frame = this.frame;
    if (this.gg) {
      const o = (y - 24) * 160;
      for (let x = 0; x < 160; x++) frame[o + x] = colors[out[x + 48]];
    } else {
      const o = y * 256;
      for (let x = 0; x < 256; x++) frame[o + x] = colors[out[x]];
    }
  }
}
