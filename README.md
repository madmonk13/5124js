# 5124js

A touch-first Sega Master System and Game Gear emulator for phones and desktop,
in plain JavaScript with no dependencies. A sibling of [SM83js](../SM83js) (Game
Boy) and [z80js](../z80js) (arcade), sharing their app shell: gesture controls,
a saved game library, pause and resume, battery saves and an installable web app.

Named for the Sega 315-5124, the video chip of the Mark III and the Master System (the Game Gear's
is its descendant), as the other apps are named for their chips.

## Offline and install

The app is a PWA: open it once while online and a service worker (`sw.js`) caches it, so it then
starts and plays without a network, from the browser or installed to the home screen ("Add to Home
Screen" on iOS, "Install app" in Chrome). Games you've added stay available offline. When online it
always loads the current version from the network first, and the cache follows.

**Install** (in Settings, next to the title) installs it as an app where the browser allows that
from a page (Chrome, Edge and other Chromium browsers, on computers and Android). Safari can't be
asked by a page, so there the button says how: Share › Add to Home Screen on iPhone and iPad, or
File › Add to Dock on a Mac. It's hidden in browsers that can't install apps (Firefox) and once
the app is installed.

Service workers only run on **https** or **localhost**: serving the folder over plain http to a
phone on the LAN works, but without offline support. `sw.js` is generated: `npm start` rebuilds it,
or run `npm run sw` after changing files, and commit it with them.

## Running

```bash
npm start
```

Then open http://localhost:2612 and add a `.sms` or `.gg` ROM (zipped is fine).
A `.gg` file runs as a Game Gear. No games are included.

## What it emulates

- **CPU:** the Z80 from z80js, at 3.58 MHz, 228 cycles a scanline, 262 lines (NTSC, 59.92 frames a second).
- **Video** (`src/emu/vdp.js`): the Mode 4 picture drawn a scanline at a time, so mid-frame scroll
  changes (status bars, parallax) work: the scrolling 32x28 tile background with flipped tiles,
  two palettes and per-tile priority; 64 sprites, 8 a line, tall and doubled sprites, the
  sprite shift; the top-rows and right-columns scroll locks and the blanked left column;
  frame and line interrupts; sprite overflow and collision flags; the V and H counters.
  The Game Gear shows the 160x144 middle of the picture, in 12-bit color.
- **Sound:** the SN76489 from z80js, as Sega's variant (a 16-bit noise register).
- **Cartridges** (`src/emu/cart.js`): the Sega mapper with cartridge RAM (saved like a battery
  save once a game writes it), Codemasters and Korean mappers, recognized by the game's first
  write, and 512-byte copier headers.
- **Controllers:** the pad (d-pad, buttons 1 and 2), the Master System's Pause button (an
  interrupt) and the Game Gear's Start button; the controller port's TH lines read back as on
  an export console, which is how games tell it from a Japanese one.

There's no BIOS: games start straight from the cartridge, as the BIOS would leave things.

## Controls

- **Touch:** the left half is a d-pad that appears where your finger lands.
  The right half is button 2 stacked over button 1. **Pause** (Master System) or **Start**
  (Game Gear) is in the top bar. Left-handed mode swaps the sides.
- **Control zones** (as in z80js): faint outlines show each control's area,
  with adjustable opacity. The zone overlap slider sets how far the zones
  reach over the picture: in portrait they sit in the band below it, starting
  that share of the picture's height up from its bottom edge, with 2 over 1;
  in landscape 2 takes the top half and 1 the bottom, and the outlines stop
  short of the middle by that share of the picture's width.
- **Keyboard:** arrows or WASD; Z or J for button 1; X or K for button 2; Return for
  Pause (Start on the Game Gear); P pauses the emulator.
- **Gamepad:** d-pad or left stick; the bottom (or left) face button is 1 and the right
  (or top) 2; Start for Pause / Start.
- **Hints follow how you play.** On a phone or tablet the control zones show; on a computer, or as
  soon as you press a key or a gamepad button, they're replaced by a card listing the keys (or
  gamepad buttons), shown as a game starts and while it's paused, and the same list is in
  Settings › Controls. Touching the screen brings the zones back. **Hints for** in Settings fixes
  it to Touch, Keys or Pad instead of Auto. A gamepad's Start button also resumes a paused game.

## Testing

```bash
node tools/make-test-rom.mjs roms/test/5124-test.sms    # a tiny hand-assembled test cart
node tools/run-rom.mjs roms/test/5124-test.sms 60 out/test.png
node tools/run-rom.mjs game.sms 1200 out/title.png start@600
```

`run-rom.mjs` runs a ROM headless for some frames (pressing buttons at given frames) and saves
the screen as a PNG; a `.gg` file runs as a Game Gear. The test cart sets up the video chip,
a palette, a tile, a checkerboard background and a sprite, and scrolls from the frame interrupt.

## Known gaps

- The Japanese FM sound unit (YM2413) and its games' FM music; they play their PSG music instead.
- SG-1000 / SC-3000 games and the older video modes they use.
- PAL timing (50 Hz), the light phaser, paddle and sports pad, and Game Gear games that run in
  Master System mode.
- Game Gear stereo (the sound is mono).
