import { describe, expect, it } from 'vitest';
import { assertPositiveKobo } from './assert-positive-kobo';

describe('assertPositiveKobo', () => {
  it('accepts positive safe integers and rejects zero', () => {
    // Arrange & Act & Assert
    expect(() => assertPositiveKobo(1, 'price')).not.toThrow();
    expect(() => assertPositiveKobo(0, 'price')).toThrow(RangeError);
    expect(() => assertPositiveKobo(-5, 'price')).toThrow(RangeError);
  });
});
