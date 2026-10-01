import { describe, expect, it } from 'vitest';
import { validateBuilderAiEditComplexity } from './complexity-validator';

function component(index: number) {
  return { props: { id: `block-${index}` }, type: 'Text' };
}

describe('builder AI edit complexity validator', () => {
  it('accepts 101 top-level persisted blocks while preserving the 500-block cap', () => {
    expect(
      validateBuilderAiEditComplexity({
        content: Array.from({ length: 101 }, (_, index) => component(index)),
        root: { title: 'Home' },
      }).success
    ).toBe(true);
    expect(
      validateBuilderAiEditComplexity({
        content: Array.from({ length: 500 }, (_, index) => component(index)),
        root: { title: 'Home' },
      }).success
    ).toBe(true);
    expect(
      validateBuilderAiEditComplexity({
        content: Array.from({ length: 501 }, (_, index) => component(index)),
        root: { title: 'Home' },
      }).success
    ).toBe(false);
  });

  it('rejects an independently nested array with more than 100 items', () => {
    expect(
      validateBuilderAiEditComplexity({
        content: [component(0)],
        root: { title: 'Home' },
        zones: { nested: Array.from({ length: 101 }, () => 'item') },
      }).success
    ).toBe(false);
  });

  it('accepts a zone collection with more than 100 builder components', () => {
    expect(
      validateBuilderAiEditComplexity({
        content: [],
        root: { title: 'Home' },
        zones: {
          main: Array.from({ length: 101 }, (_, index) => component(index)),
        },
      }).success
    ).toBe(true);
  });

  it('rejects overlarge zones, strings, depth, and serialized documents', () => {
    expect(
      validateBuilderAiEditComplexity({
        content: [],
        root: { title: 'Home' },
        zones: Object.fromEntries(
          Array.from({ length: 101 }, (_, index) => [`zone-${index}`, []])
        ),
      }).success
    ).toBe(false);
    expect(
      validateBuilderAiEditComplexity('x'.repeat(32 * 1024 + 1)).success
    ).toBe(false);
    expect(
      validateBuilderAiEditComplexity({
        a: {
          b: {
            c: {
              d: {
                e: { f: { g: { h: { i: { j: { k: { l: { m: 1 } } } } } } } },
              },
            },
          },
        },
      }).success
    ).toBe(false);
    expect(
      validateBuilderAiEditComplexity(
        Object.fromEntries(
          Array.from({ length: 60 }, (_, index) => [
            `copy-${index}`,
            'x'.repeat(20_000),
          ])
        )
      ).success
    ).toBe(false);
  });
});
