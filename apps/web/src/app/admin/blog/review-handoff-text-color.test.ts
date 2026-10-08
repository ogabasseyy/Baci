import { describe, expect, it } from 'vitest';
import { textColorMarkers } from './review-handoff-text-color';

describe('textColorMarkers', () => {
  it.each([
    [['text-black']],
    [['text-emerald-600']],
    [['text-foreground']],
    [['text-store-primary-text']],
    [['text-black/50']],
    [['text-black/[var(--alpha)]']],
    [['md:text-black']],
    [['text-white', 'text-transparent']],
    [['text-black', 'md:text-transparent']],
    [['md:text-transparent', 'lg:text-black']],
  ])('reports an opaque winner: %s', (classes) => {
    expect(textColorMarkers(classes).opaqueColor).toBe(true);
  });

  it.each([
    [['text-transparent']],
    [['text-black', 'text-transparent']],
    [['md:text-black', 'md:text-transparent', 'text-transparent']],
    [['text-black/0']],
    [['text-white/0', 'text-black']],
    [['text-transparent', 'md:text-transparent']],
  ])('reports transparency without an opaque winner: %s', (classes) => {
    const markers = textColorMarkers(classes);
    expect(markers.opaqueColor).toBe(false);
    expect(markers.transparentColor).toBe(true);
  });

  it.each([
    [['text-black', 'text-inherit']],
    [['text-current']],
    [['md:text-transparent']],
    [['text-sm']],
    [['text-center']],
    [['text-unknown']],
    [[]],
  ])('passes through without a deciding winner: %s', (classes) => {
    const markers = textColorMarkers(classes);
    expect(markers.opaqueColor).toBe(false);
    expect(markers.transparentColor).toBe(false);
  });

  it.each([
    [
      'gradient with stops',
      [
        'bg-linear-to-r',
        'from-red-500',
        'to-orange-500',
        'bg-clip-text',
        'text-transparent',
      ],
    ],
    ['solid paint', ['bg-red-500', 'bg-clip-text', 'text-transparent']],
    ['theme paint', ['bg-store-primary', 'bg-clip-text', 'text-transparent']],
    [
      'cross-layer paint',
      ['md:bg-red-500', 'bg-clip-text', 'text-transparent'],
    ],
    ['cross-layer clip', ['bg-red-500', 'md:bg-clip-text', 'text-transparent']],
    [
      'arbitrary paint',
      ['bg-[url(/a.png)]', 'bg-clip-text', 'text-transparent'],
    ],
    [
      'legacy gradient',
      ['bg-gradient-to-r', 'from-red-500', 'bg-clip-text', 'text-transparent'],
    ],
  ])('pairs a clip with an effective background: %s', (_, classes) => {
    expect(textColorMarkers(classes).clippedBackground).toBe(true);
  });

  it.each([
    ['clip without paint', ['bg-clip-text', 'text-transparent']],
    ['paint without clip', ['bg-red-500', 'text-transparent']],
    [
      'transparent paint',
      ['bg-transparent', 'bg-clip-text', 'text-transparent'],
    ],
    ['zero-alpha paint', ['bg-red-500/0', 'bg-clip-text', 'text-transparent']],
    [
      'gradient without stops',
      ['bg-linear-to-r', 'bg-clip-text', 'text-transparent'],
    ],
    [
      'transparent stops',
      [
        'bg-linear-to-r',
        'from-transparent',
        'bg-clip-text',
        'text-transparent',
      ],
    ],
    ['non-text clip', ['bg-red-500', 'bg-clip-border', 'text-transparent']],
    ['no clip or paint', ['text-transparent']],
  ])('withholds pairing without both sides: %s', (_, classes) => {
    expect(textColorMarkers(classes).clippedBackground).toBe(false);
  });
});
