import { describe, expect, it } from 'vitest';
import { compareNaturalOrder } from './review-handoff-utility-order';

describe('compareNaturalOrder', () => {
  it.each([
    ['h-20', 'h-100'],
    ['text-red-50', 'text-red-100/0'],
    ['bg-blue-50', 'bg-blue-100/0'],
    ['from-red-50', 'from-red-100'],
    ['opacity-100', 'opacity-[0]'],
    ['opacity-0', 'opacity-[0]'],
    ['h-4', 'h-[10px]'],
    ['h-[10px]', 'h-auto'],
    ['from-[#00ff00]', 'from-blue-500'],
    ['bg-clip-border', 'bg-clip-text'],
    ['invisible', 'visible'],
    ['size-0', 'size-auto'],
    ['max-h-0', 'max-h-full'],
  ])('sorts %s before %s', (first, second) => {
    expect(compareNaturalOrder(first, second)).toBeLessThan(0);
    expect(compareNaturalOrder(second, first)).toBeGreaterThan(0);
  });

  it('orders prefixes before their extensions', () => {
    expect(compareNaturalOrder('opacity-0', 'opacity-0/50')).toBeLessThan(0);
    expect(compareNaturalOrder('text-red-500', 'text-red-500/0')).toBeLessThan(
      0
    );
  });

  it('treats identical utilities as ties', () => {
    expect(compareNaturalOrder('h-4', 'h-4')).toBe(0);
  });

  it('orders longer zero-padded numbers later', () => {
    expect(compareNaturalOrder('opacity-007', 'opacity-7')).toBeGreaterThan(0);
  });
});
