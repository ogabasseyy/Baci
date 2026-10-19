import { clampImageDecodeDimension } from './image-decode-dimensions';

describe('clampImageDecodeDimension', () => {
  it('returns a safe positive value for invalid dimensions', () => {
    expect(clampImageDecodeDimension(Number.NaN)).toBe(1);
    expect(clampImageDecodeDimension(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('rounds and caps valid dimensions at the shared decode limit', () => {
    expect(clampImageDecodeDimension(12.2)).toBe(13);
    expect(clampImageDecodeDimension(4_000)).toBe(3_840);
  });
});
