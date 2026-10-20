// The Sega Master System and Game Gear: a Z80 at 3.58 MHz, 8 KB of work RAM,
// the video chip (vdp.js) with its built-in SN76489 sound, the cartridge
// (cart.js), and the controllers. The Game Gear is the same machine in a
// handheld: a smaller window on the picture, more colors, and a Start button
// where the Master System has a Pause button on the console.
//
//   0000-BFFF cartridge (three 16 KB slots)    C000-DFFF work RAM (mirrored at E000-FFFF)
//   FFFC-FFFF also the Sega mapper's registers
//
// I/O ports, by address lines 7, 6 and 0: 3E memory control, 3F controller
// port control (its TH outputs read back on DD, which games use to tell a
// Japanese console from an export one); 7E/7F the vertical and horizontal
// counters (writes: the sound chip); BE/BF the video chip; DC/DD the
// controllers. On the Game Gear, ports 00-06 are its own (00: Start and region).
//
// There's no BIOS here: games start straight from the cartridge, set up as the
// BIOS leaves things (stack at DFF0, interrupt mode 1).

import { Z80 } from './z80.js';
import { VDP, LINES } from './vdp.js';
import { SN76489 } from './sn76489.js';
import { Cart } from './cart.js';
import { capture, apply } from './state.js';

export const CLOCK = 3579545;
export const LINE_CYCLES = 228;
export const FPS = CLOCK / (LINES * LINE_CYCLES);   // about 59.92
export const SAMPLE_RATE = 48000;
const ACTIVE_CYCLES = 171;                          // the part of each line before the line interrupt

const STATE = ['cpu', 'vdp', 'psg', 'cart', 'ram', 'io3f', 'lastButtons', 'sampleAcc', 'lineStart', 'carry'];

// The sound chip's output as a ring buffer the browser's audio output drains (as on the Game Boy app).
class Sound {
  constructor(psg) {
    this.psg = psg;
    this.buffer = new Float32Array(1 << 15);
    this.writePos = this.readPos = 0;
    this.dcIn = 0; this.dcOut = 0;
  }
  sample() {
    this.psg.sample();
    const s = this.psg.out;
    const out = s - this.dcIn + 0.996 * this.dcOut;   // the chip only adds positive levels: center it
    this.dcIn = s; this.dcOut = out;
    const buf = this.buffer, mask = buf.length - 1;
    buf[this.writePos] = out * 1.4;
    this.writePos = (this.writePos + 1) & mask;
    if (this.writePos === this.readPos) this.readPos = (this.readPos + 1) & mask;
  }
  available() { return (this.writePos - this.readPos) & (this.buffer.length - 1); }
  // Fallback output path (ScriptProcessor): resample into `out` at `outRate`.
  pull(out, outRate) {
    const buf = this.buffer, mask = buf.length - 1, step = SAMPLE_RATE / outRate;
    if (this.available() > SAMPLE_RATE * 0.075) this.readPos = (this.writePos - Math.floor(SAMPLE_RATE * 0.035)) & mask;
    let pos = this.frac || 0, last = this.last || 0;
    for (let i = 0; i < out.length; i++) {
      if (this.available() < 2) { out[i] = last *= 0.995; continue; }
      const s0 = buf[this.readPos], s1 = buf[(this.readPos + 1) & mask];
      last = out[i] = s0 + (s1 - s0) * pos;
      pos += step;
      while (pos >= 1 && this.available() > 1) { pos -= 1; this.readPos = (this.readPos + 1) & mask; }
    }
    this.frac = pos; this.last = last;
  }
}

export class MasterSystem {
  saveState() { return capture(this, STATE); }
  loadState(s) { apply(this, STATE, s); }

  constructor() {
    this.gg = false;
    this.vdp = new VDP(false);
    this.psg = new SN76489(CLOCK);
    this.psg.rate = SAMPLE_RATE;
    this.apu = new Sound(this.psg);          // the audio output's source (named as on the Game Boy app)
    this.cpu = new Z80({
      read: (a) => this.read(a), write: (a, v) => this.write(a, v),
      input: (p) => this.in(p & 0xFF), output: (p, v) => this.out(p & 0xFF, v),
    });
    this.cart = null;
    this.buttons = 0;                        // pressed: 01 right, 02 left, 04 up, 08 down, 10 button 2, 20 button 1, 80 Start/Pause
    this.lastButtons = 0;
    this.ram = new Uint8Array(0x2000);
  }

  get width() { return this.vdp.width; }
  get height() { return this.vdp.height; }
  get frame() { return this.vdp.frame; }

  // gg: run it as a Game Gear (from the file name: .gg).
  load(rom, { gg = false } = {}) {
    this.gg = gg;
    this.vdp = new VDP(gg);
    this.cart = new Cart(rom);
    this.cart.console = gg ? 'Game Gear' : 'Master System';
    this.reset();
    return this.cart;
  }

  reset() {
    this.vdp.reset();
    this.psg.reset();
    this.apu.dcIn = this.apu.dcOut = 0;
    this.cart && this.cart.reset();
    this.ram.fill(0);
    this.io3f = 0xFF;
    this.lastButtons = 0;
    this.sampleAcc = 0;
    this.lineStart = 0;
    this.carry = 0;
    const c = this.cpu;
    c.reset();
    c.sp = 0xDFF0; c.im = 1;
  }

  // ---------------------------------------------------------------- buses

  read(a) {
    if (a < 0xC000) return this.cart.read(a);
    return this.ram[a & 0x1FFF];
  }

  write(a, v) {
    if (a < 0xC000) { this.cart.write(a, v); return; }
    this.ram[a & 0x1FFF] = v;
    if (a >= 0xFFFC) this.cart.mapper(a, v);
  }

  in(p) {
    if (this.gg && p <= 6) {
      if (p === 0) return (this.buttons & 0x80 ? 0 : 0x80) | 0x40;   // Start (low when pressed); export console
      return p === 1 ? 0x7F : p === 5 ? 0 : 0xFF;                     // the link port: idle
    }
    switch (p & 0xC1) {
      case 0x40: return this.vdp.vcounter();
      case 0x41: return Math.min(0xE9, ((this.cpu.cycles - this.lineStart) * 342 / LINE_CYCLES) >> 1);
      case 0x80: return this.vdp.readData();
      case 0x81: { const v = this.vdp.readStatus(); this.cpu.irq = !!this.vdp.irq; return v; }
      case 0xC0: {
        const b = this.buttons;
        return 0xFF & ~((b & 4 ? 1 : 0) | (b & 8 ? 2 : 0) | (b & 2 ? 4 : 0) | (b & 1 ? 8 : 0) | (b & 0x20 ? 0x10 : 0) | (b & 0x10 ? 0x20 : 0));
      }
      case 0xC1: {
        // Player 2 and Reset not pressed; TH-A and TH-B read back what port 3F drives (an export console).
        const io = this.io3f;
        return 0x3F | (io & 2 ? 0x40 : io & 0x20 ? 0x40 : 0) | (io & 8 ? 0x80 : io & 0x80 ? 0x80 : 0);
      }
      default: return 0xFF;
    }
  }

  out(p, v) {
    if (this.gg && p <= 6) return;                // Game Gear link port and stereo control
    switch (p & 0xC1) {
      case 0x01: this.io3f = v; break;
      case 0x40: case 0x41: this.psg.write(v); break;
      case 0x80: this.vdp.writeData(v); break;
      case 0x81: this.vdp.writeControl(v); this.cpu.irq = !!this.vdp.irq; break;
    }
  }

  // ---------------------------------------------------------------- running

  run(cycles) {
    const cpu = this.cpu, vdp = this.vdp, end = cpu.cycles + cycles, start = cpu.cycles;
    while (cpu.cycles < end) {
      cpu.irq = !!vdp.irq;
      cpu.step();
    }
    // Sound for the time just run.
    this.sampleAcc += ((cpu.cycles - start) * SAMPLE_RATE) / CLOCK;
    while (this.sampleAcc >= 1) { this.sampleAcc -= 1; this.apu.sample(); }
  }

  runFrame() {
    if (!this.cart) return;
    // Pause (on the Master System console) is a non-maskable interrupt when pressed.
    if (!this.gg && (this.buttons & 0x80) && !(this.lastButtons & 0x80)) this.cpu.nmi();
    this.lastButtons = this.buttons;
    const vdp = this.vdp;
    // Lines start every 228 cycles exactly; an instruction running past the end of one just
    // leaves the next a little shorter.
    let base = this.cpu.cycles - (this.carry || 0);
    for (let line = 0; line < LINES; line++, base += LINE_CYCLES) {
      this.lineStart = base;
      vdp.startLine(line);
      vdp.renderLine(line);
      this.run(base + ACTIVE_CYCLES - this.cpu.cycles);
      vdp.endActive(line);
      this.run(base + LINE_CYCLES - this.cpu.cycles);
    }
    this.carry = this.cpu.cycles - base;
  }
}
