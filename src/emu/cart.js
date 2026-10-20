// Cartridges: ROM in 16 KB banks, switched into three slots at 0000, 4000 and
// 8000, and up to 32 KB of RAM (battery-backed on the games that save).
//
//   Sega mapper (most games): writes to FFFC-FFFF. FFFD-FFFF pick the banks for
//     the three slots (the first 1 KB always shows bank 0, where the interrupt
//     handlers are); FFFC bit 3 puts cartridge RAM at 8000, bit 2 choosing which
//     16 KB of it.
//   Codemasters: writes to 0000, 4000 and 8000 pick each slot's bank.
//   Korean: writes to A000 pick the bank at 8000.
// The mapper is recognized by the game's first write into ROM space, so no
// list of games is needed.

import { capture, apply } from './state.js';

const BANK = 0x4000;
const STATE = ['slots', 'control', 'ram', 'kind', 'dirty', 'ramUsed'];

export class Cart {
  saveState() { return capture(this, STATE); }
  loadState(s) { apply(this, STATE, s); }

  constructor(rom) {
    // Some dumps carry a 512-byte copier header in front.
    if (rom.length % BANK === 512) rom = rom.subarray(512);
    const banks = Math.max(1, Math.ceil(rom.length / BANK));
    this.rom = new Uint8Array(banks * BANK);
    this.rom.set(rom);
    this.banks = banks;
    this.battery = true;           // any game may use cartridge RAM; it's only saved once written
    this.header = readHeader(this.rom);
    this.reset();
  }

  get name() { return { sega: 'Sega mapper', codemasters: 'Codemasters', korean: 'Korean' }[this.kind] || 'Sega mapper'; }

  reset() {
    this.slots = new Uint8Array([0, 1 % this.banks, 2 % this.banks]);
    this.control = 0;
    this.ram = this.ram || new Uint8Array(0x8000);
    this.kind = this.banks <= 3 ? 'sega' : null;   // decided by the first write when it matters
    this.dirty = false;
    this.ramUsed = this.ramUsed || false;
  }

  read(a) {
    if (a < 0x400 && this.kind !== 'codemasters') return this.rom[a];
    const slot = a >> 14;
    if (slot === 2 && (this.control & 8)) return this.ram[((this.control & 4) << 12) | (a & 0x3FFF)];
    return this.rom[(this.slots[slot] % this.banks) * BANK + (a & 0x3FFF)];
  }

  // A write into ROM space (0000-BFFF).
  write(a, v) {
    if (a >= 0x8000 && (this.control & 8) && this.kind !== 'codemasters') {
      this.ram[((this.control & 4) << 12) | (a & 0x3FFF)] = v;
      this.dirty = true; this.ramUsed = true;
      return;
    }
    if (!this.kind) {
      if (a === 0x0000 || a === 0x4000 || a === 0x8000) this.kind = 'codemasters';
      else if (a === 0xA000) this.kind = 'korean';
    }
    if (this.kind === 'codemasters' && (a & 0x3FFF) === 0) this.slots[a >> 14] = v % this.banks;
    else if (this.kind === 'korean' && a === 0xA000) this.slots[2] = v % this.banks;
  }

  // The Sega mapper's registers (writes to FFFC-FFFF also land in work RAM).
  mapper(a, v) {
    if (!this.kind) this.kind = 'sega';
    if (this.kind !== 'sega') return;
    if (a === 0xFFFC) this.control = v;
    else this.slots[a - 0xFFFD] = v % this.banks;
  }

  batteryData() { return this.ram.slice(); }
  loadBattery(data) { if (data && data.length) { this.ram.set(data.subarray(0, this.ram.length)); this.ramUsed = true; } }
}

// The "TMR SEGA" header (at 7FF0, or 3FF0/1FF0 on small carts): region and size.
// Game Gear carts are told apart by their file name, not the header (many omit it).
function readHeader(rom) {
  for (const at of [0x7FF0, 0x3FF0, 0x1FF0]) {
    if (at + 16 > rom.length) continue;
    if (String.fromCharCode(...rom.subarray(at, at + 8)) !== 'TMR SEGA') continue;
    const region = rom[at + 15] >> 4;
    return { found: true, region: { 3: 'SMS Japan', 4: 'SMS export', 5: 'GG Japan', 6: 'GG export', 7: 'GG international' }[region] || '' };
  }
  return { found: false, region: '' };
}
