// Pixel operations on decoded images. A bitmap is RGBA, 4 bytes per pixel, rows top to bottom.
export type Bitmap = { width: number; height: number; data: Uint8Array };

export type Filter = 'original' | 'color' | 'grayscale' | 'blackwhite';

export function blank(width: number, height: number, fill: [number, number, number, number] = [0, 0, 0, 0]): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

// Rec. 601 luma, the weighting JPEG uses.
function luma(data: Uint8Array, o: number): number {
  return Math.round(0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!);
}

function histogram(bitmap: Bitmap): Uint32Array {
  const counts = new Uint32Array(256);
  for (let o = 0; o < bitmap.data.length; o += 4) counts[luma(bitmap.data, o)]!++;
  return counts;
}

// Otsu's threshold: the grey level that best separates the histogram into two classes, so a page
// photographed in dim light still splits ink from paper.
function otsu(counts: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * counts[i]!;
  let sumBelow = 0;
  let below = 0;
  let best = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    below += counts[t]!;
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    sumBelow += t * counts[t]!;
    const meanBelow = sumBelow / below;
    const meanAbove = (sum - sumBelow) / above;
    const between = below * above * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 1; // levels up to t are black
    }
  }
  return threshold;
}

// The luma below which a fraction of the pixels fall.
function percentile(counts: Uint32Array, total: number, fraction: number): number {
  let seen = 0;
  for (let i = 0; i < 256; i++) {
    seen += counts[i]!;
    if (seen >= total * fraction) return i;
  }
  return 255;
}

export function applyFilter(bitmap: Bitmap, filter: Filter): Bitmap {
  const out = new Uint8Array(bitmap.data);
  const pixels = bitmap.width * bitmap.height;
  if (filter === 'grayscale') {
    for (let o = 0; o < out.length; o += 4) out[o] = out[o + 1] = out[o + 2] = luma(out, o);
  } else if (filter === 'blackwhite') {
    const threshold = otsu(histogram(bitmap), pixels);
    for (let o = 0; o < out.length; o += 4) out[o] = out[o + 1] = out[o + 2] = luma(out, o) >= threshold ? 255 : 0;
  } else if (filter === 'color') {
    // Stretch contrast: the darkest 1% goes to black and the lightest 1% to white, with the same
    // scale on every channel so hues hold.
    const counts = histogram(bitmap);
    const low = percentile(counts, pixels, 0.01);
    const high = percentile(counts, pixels, 0.99);
    if (high - low > 8) {
      const scale = 255 / (high - low);
      for (let o = 0; o < out.length; o += 4) {
        for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, Math.min(255, Math.round((out[o + c]! - low) * scale)));
      }
    }
  }
  return { width: bitmap.width, height: bitmap.height, data: out };
}

export function crop(bitmap: Bitmap, x: number, y: number, width: number, height: number): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * bitmap.width + x) * 4;
    data.set(bitmap.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

// Top above bottom, left-aligned; the uncovered area is white, as on a page.
export function stack(top: Bitmap, bottom: Bitmap): Bitmap {
  const out = blank(Math.max(top.width, bottom.width), top.height + bottom.height, [255, 255, 255, 255]);
  for (const [image, y0] of [[top, 0], [bottom, top.height]] as const) {
    for (let row = 0; row < image.height; row++) {
      out.data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), (y0 + row) * out.width * 4);
    }
  }
  return out;
}

// Composites onto white, for formats without transparency.
export function flatten(bitmap: Bitmap): Bitmap {
  const data = new Uint8Array(bitmap.data);
  for (let o = 0; o < data.length; o += 4) {
    const a = data[o + 3]!;
    if (a === 255) continue;
    for (let c = 0; c < 3; c++) data[o + c] = Math.round((data[o + c]! * a + 255 * (255 - a)) / 255);
    data[o + 3] = 255;
  }
  return { width: bitmap.width, height: bitmap.height, data };
}

// For each of `to` output samples, the input samples it covers and how much of each: an area
// average, so fine detail averages out instead of aliasing when scaling down.
function spans(from: number, to: number): { first: number; weights: number[] }[] {
  const ratio = from / to;
  return Array.from({ length: to }, (_, i) => {
    const start = i * ratio;
    const end = start + ratio;
    const first = Math.floor(start);
    const weights: number[] = [];
    for (let s = first; s < Math.min(from, Math.ceil(end)); s++) weights.push((Math.min(end, s + 1) - Math.max(start, s)) / ratio);
    return { first, weights };
  });
}

export function scale(bitmap: Bitmap, width: number, height: number): Bitmap {
  if (width === bitmap.width && height === bitmap.height) return bitmap;
  const { width: w, height: h, data } = bitmap;
  // Rows first: w × h → width × h.
  const wide = new Float32Array(width * h * 4);
  const across = spans(w, width);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      const { first, weights } = across[x]!;
      const o = (y * width + x) * 4;
      for (let k = 0; k < weights.length; k++) {
        const from = (y * w + first + k) * 4;
        for (let c = 0; c < 4; c++) wide[o + c]! += data[from + c]! * weights[k]!;
      }
    }
  }
  // Then columns: width × h → width × height.
  const out = new Uint8Array(width * height * 4);
  const down = spans(h, height);
  for (let y = 0; y < height; y++) {
    const { first, weights } = down[y]!;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < weights.length; k++) sum += wide[((first + k) * width + x) * 4 + c]! * weights[k]!;
        out[o + c] = Math.max(0, Math.min(255, Math.round(sum)));
      }
    }
  }
  return { width, height, data: out };
}

// Turns a decoded image upright by its EXIF orientation (1…8).
export function orient(bitmap: Bitmap, orientation: number): Bitmap {
  if (orientation <= 1 || orientation > 8) return bitmap;
  const { width: w, height: h, data } = bitmap;
  const swap = orientation >= 5;
  const width = swap ? h : w;
  const height = swap ? w : h;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      switch (orientation) {
        case 2: [nx, ny] = [w - 1 - x, y]; break;
        case 3: [nx, ny] = [w - 1 - x, h - 1 - y]; break;
        case 4: [nx, ny] = [x, h - 1 - y]; break;
        case 5: [nx, ny] = [y, x]; break;
        case 6: [nx, ny] = [h - 1 - y, x]; break;
        case 7: [nx, ny] = [h - 1 - y, w - 1 - x]; break;
        default: [nx, ny] = [y, w - 1 - x]; break;
      }
      out.set(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ny * width + nx) * 4);
    }
  }
  return { width, height, data: out };
}
