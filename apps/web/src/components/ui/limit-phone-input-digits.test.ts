import { describe, expect, it } from 'vitest';
import { limitPhoneInputDigits } from './limit-phone-input-digits';

describe('limitPhoneInputDigits', () => {
  it.each([
    ['+234 08034096325', '+234 8034096325'],
    ['+23480123456789999', '+2348012345678'],
    ['+234 801 234 56789999', '+234 801 234 5678'],
    ['+23408012345678999', '+2348012345678'],
    ['+39066982', '+39066982'],
    ['+1234567890123456789', '+123456789012345'],
    ['', ''],
    ['+234', '+234'],
  ])('limits %s without changing significant digits', (input, expected) => {
    expect(limitPhoneInputDigits(input)).toBe(expected);
  });
});
