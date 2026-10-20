// node tools/make-test-rom.mjs [out.sms]: a tiny hand-assembled Master System test cart: VDP set up in mode 4, a palette,
// one tile, a checkerboard background, one sprite, and a frame interrupt that
// scrolls the background one pixel a frame and counts frames at C000.
import fs from 'node:fs';
const rom = new Uint8Array(0x8000);
let pc = 0;
const emit = (...b) => { for (const x of b) rom[pc++] = x & 0xFF; };
const at = (a) => { pc = a; };
const w16 = (v) => [v & 0xFF, v >> 8];

at(0x0000);
emit(0xF3);                         // di
emit(0xED, 0x56);                   // im 1
emit(0x31, ...w16(0xDFF0));         // ld sp,DFF0
emit(0xC3, ...w16(0x0100));         // jp 0100

at(0x0038);                         // interrupt handler
emit(0xF5);                         // push af
emit(0xDB, 0xBF);                   // in a,(BF)   acknowledge
emit(0x3A, ...w16(0xC000));         // ld a,(C000)
emit(0x3C);                         // inc a
emit(0x32, ...w16(0xC000));         // ld (C000),a
emit(0xD3, 0xBF);                   // out (BF),a  -> value
emit(0x3E, 0x88);                   // ld a,88     -> register 8 (horizontal scroll)
emit(0xD3, 0xBF);                   // out (BF),a
emit(0xF1);                         // pop af
emit(0xFB);                         // ei
emit(0xED, 0x4D);                   // reti

at(0x0066);
emit(0xED, 0x45);                   // retn (pause)

at(0x0100);
// VDP registers from a table: (value, 0x80|reg) pairs.
emit(0x21, ...w16(0x0400));         // ld hl,regs
emit(0x06, 22);                     // ld b,22
emit(0x0E, 0xBF);                   // ld c,BF
emit(0xED, 0xB3);                   // otir
// Palette: color RAM address 0.
emit(0x3E, 0x00, 0xD3, 0xBF, 0x3E, 0xC0, 0xD3, 0xBF);
emit(0x21, ...w16(0x0440), 0x06, 32, 0x0E, 0xBE, 0xED, 0xB3);   // 32 colors
// Tile 1 at VRAM 0020: all pixels color 1 (bitplane 0 set).
emit(0x3E, 0x20, 0xD3, 0xBF, 0x3E, 0x40, 0xD3, 0xBF);
emit(0x06, 32);                     // ld b,32
const tileLoop = pc;
emit(0x3E, 0xFF);                   // ld a,FF   (plane 0)
emit(0xD3, 0xBE);
emit(0x3E, 0x00);                   // planes 1-3 zero
emit(0xD3, 0xBE, 0xD3, 0xBE, 0xD3, 0xBE);
emit(0x10, (tileLoop - (pc + 2)) & 0xFF); // djnz -- wait: 4 bytes per row, 8 rows: loop 8 times
// Fix: b counts rows; set b=8 above instead of 32.
rom[tileLoop - 1] = 8;
// Name table at 3800: 32x28 entries alternating tile 0 / tile 1 by (row+col) parity.
emit(0x3E, 0x00, 0xD3, 0xBF, 0x3E, 0x78, 0xD3, 0xBF);
emit(0x16, 28);                     // ld d,28 rows
const rowLoop = pc;
emit(0x06, 32);                     // ld b,32 cols
const colLoop = pc;
emit(0x78);                         // ld a,b
emit(0x82);                         // add a,d
emit(0xE6, 1);                      // and 1
emit(0xD3, 0xBE);                   // out (BE),a  tile number low
emit(0xAF);                         // xor a
emit(0xD3, 0xBE);                   // out (BE),a  attributes
emit(0x10, (colLoop - (pc + 2)) & 0xFF);
emit(0x15);                         // dec d
emit(0x20, (rowLoop - (pc + 2)) & 0xFF);
// Sprite table at 3F00: sprite 0 at y=80 (line 81), then the end marker; x=128, tile 1.
emit(0x3E, 0x00, 0xD3, 0xBF, 0x3E, 0x7F, 0xD3, 0xBF);
emit(0x3E, 80, 0xD3, 0xBE, 0x3E, 0xD0, 0xD3, 0xBE);
emit(0x3E, 0x80, 0xD3, 0xBF, 0x3E, 0x7F, 0xD3, 0xBF);
emit(0x3E, 128, 0xD3, 0xBE, 0x3E, 1, 0xD3, 0xBE);
// Display and frame interrupt on.
emit(0x3E, 0xE0, 0xD3, 0xBF, 0x3E, 0x81, 0xD3, 0xBF);
emit(0xFB);                         // ei
const loop = pc;
emit(0x76);                         // halt
emit(0x18, (loop - (pc + 2)) & 0xFF); // jr loop

at(0x0400);                         // VDP registers 0-10
const regs = [0x26, 0xA0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFB, 0x00, 0x00, 0x00, 0xFF];
for (let r = 0; r < regs.length; r++) emit(regs[r], 0x80 | r);
at(0x0440);                         // palette: background 0 black, 1 white; sprite 1 red (16..31)
const pal = new Array(32).fill(0);
pal[0] = 0x00; pal[1] = 0x3F; pal[17] = 0x03;
emit(...pal);
// The header.
at(0x7FF0);
emit(...[...'TMR SEGA'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0, 0x4C);
fs.writeFileSync(process.argv[2] || 'test.sms', rom);
console.log('test.sms written', rom.length);
