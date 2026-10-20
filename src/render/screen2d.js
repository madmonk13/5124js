// Draws the machine's frame (RGBA pixels) to a canvas at native size: 256x192
// for the Master System, 160x144 for the Game Gear. CSS scales it up with
// crisp pixels.

export class Screen2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize(256, 192);
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.image = this.ctx.createImageData(w, h);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  draw(frame, w = this.canvas.width, h = this.canvas.height) {
    if (w !== this.canvas.width || h !== this.canvas.height) this.resize(w, h);
    this.pixels.set(frame);
    this.ctx.putImageData(this.image, 0, 0);
  }
}
