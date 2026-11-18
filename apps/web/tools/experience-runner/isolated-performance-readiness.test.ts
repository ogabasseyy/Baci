import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isolatedReadinessExpression } from './isolated-performance-readiness';

type ElementFixture = {
  rect: {
    width: number;
    height: number;
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
  style?: { display?: string; visibility?: string; opacity?: string };
  parentElement?: ElementFixture | null;
  textContent?: string;
  inert?: boolean;
  complete?: boolean;
  naturalWidth?: number;
  querySelector?: (selector: string) => ElementFixture | null;
  getBoundingClientRect: () => ElementFixture['rect'];
};

const element = (overrides: Partial<ElementFixture> = {}): ElementFixture => ({
  rect: { width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100 },
  getBoundingClientRect() {
    return this.rect;
  },
  ...overrides,
});

function evaluate(role: 'host' | 'child', setup: Record<string, unknown>) {
  return runInNewContext(isolatedReadinessExpression(role), {
    ...setup,
    innerHeight: 800,
    innerWidth: 1200,
    performance: { timeOrigin: 1234 },
    getComputedStyle: (node: ElementFixture) => ({
      display: node.style?.display ?? 'block',
      visibility: node.style?.visibility ?? 'visible',
      opacity: node.style?.opacity ?? '1',
    }),
  }) as Record<string, unknown>;
}

describe('isolated readiness expression', () => {
  it('requires an in-viewport iframe and the opted-in bridge-ready marker', () => {
    const parent = element();
    const frame = element({ parentElement: parent });
    const document = {
      querySelector: () => frame,
      documentElement: {
        hasAttribute: () => true,
        dataset: { baciPerformanceBridgeReady: 'false' },
      },
    };

    expect(evaluate('host', { document })).toEqual({
      visible: false,
      timeOrigin: 1234,
    });

    document.documentElement.dataset.baciPerformanceBridgeReady = 'true';
    expect(evaluate('host', { document })).toEqual({
      visible: true,
      timeOrigin: 1234,
    });
    parent.style = { opacity: '0' };
    expect(evaluate('host', { document }).visible).toBe(false);
  });

  it('requires visible child content and decoded in-viewport images', () => {
    const parent = element();
    const root = element({ parentElement: parent, textContent: 'Ready' });
    const image = element({
      complete: true,
      naturalWidth: 320,
    });
    root.querySelector = () => element();
    const document = { querySelector: () => root, images: [image] };

    expect(evaluate('child', { document })).toEqual({
      visible: true,
      imagesDecoded: true,
    });

    image.naturalWidth = 0;
    expect(evaluate('child', { document }).imagesDecoded).toBe(false);
    root.inert = true;
    expect(evaluate('child', { document })).toEqual({
      visible: false,
      imagesDecoded: false,
    });
  });
});
