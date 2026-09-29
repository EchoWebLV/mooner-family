/** Integer-only drawing on the single 128 × 128 art grid. No blended edge pixels. */
export type Point = readonly [number, number];
export class Raster {
  readonly width = 128;
  readonly height = 128;
  readonly data = new Uint8ClampedArray(128 * 128 * 4);
  private colors = new Map<string, number[]>();
  pixel(x: number, y: number, color: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= 128 || y >= 128) {
      return;
    }
    let rgb = this.colors.get(color);
    if (!rgb) {
      const n = parseInt(color.slice(1), 16);
      rgb = [n >> 16, n >> 8 & 255, n & 255];
      this.colors.set(color, rgb);
    }
    const i = (y * 128 + x) * 4;
    this.data.set([...rgb, 255], i);
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        this.pixel(i, j, c);
      }
    }
  }
  ellipse(x: number, y: number, rx: number, ry: number, c: string) {
    for (let j = Math.ceil(y - ry); j <= y + ry; j++) {
      for (let i = Math.ceil(x - rx); i <= x + rx; i++) {
        if ((i - x) ** 2 / rx ** 2 + (j - y) ** 2 / ry ** 2 <= 1) {
          this.pixel(i, j, c);
        }
      }
    }
  }
  poly(points: readonly Point[], c: string) {
    const minY = Math.min(...points.map(p => p[1])),
      maxY = Math.max(...points.map(p => p[1]));
    for (let y = minY; y <= maxY; y++) {
      for (let x = Math.min(...points.map(p => p[0])); x <= Math.max(...points.map(p => p[0])); x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i],
            b = points[j];
          if (a[1] > y !== b[1] > y && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) {
            inside = !inside;
          }
        }
        if (inside) {
          this.pixel(x, y, c);
        }
      }
    }
  }
  line(x: number, y: number, ex: number, ey: number, c: string, width = 1) {
    const steps = Math.max(Math.abs(ex - x), Math.abs(ey - y));
    for (let i = 0; i <= steps; i++) {
      this.rect(Math.round(x + (ex - x) * i / (steps || 1)), Math.round(y + (ey - y) * i / (steps || 1)), width, width, c);
    }
  }
  star(x: number, y: number, size: number, c: string) {
    this.poly([[x, y - size], [x + 2, y - 2], [x + size, y], [x + 2, y + 2], [x, y + size], [x - 2, y + 2], [x - size, y], [x - 2, y - 2]], c);
    this.pixel(x, y - size, c);
  }
}
