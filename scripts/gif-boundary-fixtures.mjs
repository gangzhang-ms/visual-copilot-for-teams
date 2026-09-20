// Tiny original fixtures encode explicit GIF frame rectangles/disposal, without relying on an encoder's optimization.
export function boundaryGif(frames) {
  const word = n => [n & 255, n >> 8];
  const bytes = [...Buffer.from("GIF89a"), ...word(3), ...word(1), 0x81, 0, 0,
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  for (const { pixels, left = 0, disposal = 1, delay = 10 } of frames) {
    const codes = pixels.flatMap(pixel => [4, pixel]).concat(5);
    const packed = []; let accumulator = 0, bits = 0;
    for (const code of codes) {
      accumulator |= code << bits; bits += 3;
      while (bits >= 8) { packed.push(accumulator & 255); accumulator >>= 8; bits -= 8; }
    }
    if (bits) packed.push(accumulator);
    bytes.push(0x21, 0xf9, 4, (disposal << 2) | 1, ...word(delay), 0, 0,
      0x2c, ...word(left), ...word(0), ...word(pixels.length), ...word(1), 0, 2, packed.length, ...packed, 0);
  }
  return Buffer.from([...bytes, 0x3b]);
}
export const rgba = indices => Buffer.from(indices.flatMap(i => [
  [0, 0, 0, 0], [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]
][i]));
