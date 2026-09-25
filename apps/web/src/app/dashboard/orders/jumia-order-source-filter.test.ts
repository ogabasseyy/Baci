import { describe, expect, it } from 'vitest';
import {
  JUMIA_ORDER_SOURCE_FILTER,
  parseJumiaOrderSourceFilter,
} from './jumia-order-source-filter';

describe('parseJumiaOrderSourceFilter', () => {
  it('parses the Jumia source filter case-insensitively', () => {
    expect(parseJumiaOrderSourceFilter('jumia')).toBe(
      JUMIA_ORDER_SOURCE_FILTER
    );
    expect(parseJumiaOrderSourceFilter(' Jumia ')).toBe(
      JUMIA_ORDER_SOURCE_FILTER
    );
    expect(parseJumiaOrderSourceFilter(['jumia'])).toBe(
      JUMIA_ORDER_SOURCE_FILTER
    );
  });

  it('ignores unsupported order source filters', () => {
    expect(parseJumiaOrderSourceFilter('agentic')).toBeUndefined();
    expect(parseJumiaOrderSourceFilter('whatsapp')).toBeUndefined();
    expect(parseJumiaOrderSourceFilter('')).toBeUndefined();
    expect(parseJumiaOrderSourceFilter('jumia!')).toBeUndefined();
    expect(parseJumiaOrderSourceFilter(null)).toBeUndefined();
    expect(parseJumiaOrderSourceFilter(undefined)).toBeUndefined();
    expect(parseJumiaOrderSourceFilter(123 as never)).toBeUndefined();
  });
});
