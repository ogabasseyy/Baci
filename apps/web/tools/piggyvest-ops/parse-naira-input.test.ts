import { describe, expect, it } from 'vitest';
import { parseNairaInput } from './parse-naira-input';

describe('parseNairaInput', () => {
  it.each([
    ['1234567.89', 123_456_789],
    ['1,234,567.89', 123_456_789],
    ['₦1,234,567.89', 123_456_789],
    [' 15000 ', 1_500_000],
    ['15000.5', 1_500_050],
    ['0.05', 5],
  ])('reads %s as %i kobo', (text, kobo) => {
    expect(parseNairaInput(text)).toBe(kobo);
  });

  it.each([
    '',
    '-15000',
    '15000.001',
    '15,00.00',
    '1e5',
    '15000 naira',
    '９９',
    '99999999999999999999',
  ])('refuses %j', (text) => {
    expect(parseNairaInput(text)).toBeNull();
  });
});
