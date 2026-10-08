import { describe, expect, it } from 'vitest';
import { textColorMarkers } from './review-handoff-text-color';

const ALL = [true, true, true, true, true, true];
const NONE = [false, false, false, false, false, false];
const MD_UP = [false, false, true, true, true, true];
const BELOW_MD = [true, true, false, false, false, false];
const LG_UP = [false, false, false, true, true, true];

describe('textColorMarkers', () => {
  it.each([
    [['text-black'], ALL],
    [['text-emerald-600'], ALL],
    [['text-foreground'], ALL],
    [['text-store-primary-text'], ALL],
    [['text-black/50'], ALL],
    [['text-black/[var(--alpha)]'], ALL],
    [['text-[#B76E79]'], ALL],
    [['text-[rgb(183,110,121)]'], ALL],
    [['text-[red]'], ALL],
    [['text-[#B76E79]/50'], ALL],
    [['text-(--brand-color)'], ALL],
    [['md:text-black'], MD_UP],
    [['text-white', 'text-transparent'], ALL],
    [['text-black', 'md:text-transparent'], BELOW_MD],
    [['md:text-transparent', 'lg:text-black'], LG_UP],
    [['text-transparent', 'text-black!'], ALL],
    [['md:text-transparent', 'text-black!'], ALL],
  ])('reports an opaque winner: %s', (classes, expected) => {
    expect(textColorMarkers(classes).opaqueAt).toEqual(expected);
  });

  it.each([
    [['text-transparent'], ALL],
    [['text-black', 'text-transparent'], ALL],
    [['md:text-black', 'md:text-transparent', 'text-transparent'], ALL],
    [['text-black/0'], ALL],
    [['text-[#B76E79]/0'], ALL],
    [['text-[transparent]'], ALL],
    [['text-white/0', 'text-black'], ALL],
    [['text-transparent', 'md:text-transparent'], ALL],
    [['md:text-transparent'], MD_UP],
    [['text-black', 'text-transparent!'], ALL],
  ])('reports transparency without an opaque winner: %s', (classes, expected) => {
    const markers = textColorMarkers(classes);
    expect(markers.opaqueAt).toEqual(NONE);
    expect(markers.transparentAt).toEqual(expected);
  });

  it('resolves scoped important transparency against an ordinary base', () => {
    const markers = textColorMarkers(['text-black', 'md:text-transparent!']);
    expect(markers.opaqueAt).toEqual(BELOW_MD);
    expect(markers.transparentAt).toEqual(MD_UP);
  });

  it.each([
    [['text-black', 'text-inherit']],
    [['text-current']],
    [['text-[12px]']],
    [['text-[12px]/50']],
    [['text-sm']],
    [['text-center']],
    [['text-unknown']],
    [[]],
  ])('passes through without a deciding winner: %s', (classes) => {
    const markers = textColorMarkers(classes);
    expect(markers.opaqueAt).toEqual(NONE);
    expect(markers.transparentAt).toEqual(NONE);
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
      ALL,
    ],
    ['solid paint', ['bg-red-500', 'bg-clip-text', 'text-transparent'], ALL],
    [
      'theme paint',
      ['bg-store-primary', 'bg-clip-text', 'text-transparent'],
      ALL,
    ],
    [
      'cross-layer paint',
      ['md:bg-red-500', 'bg-clip-text', 'text-transparent'],
      MD_UP,
    ],
    [
      'cross-layer clip',
      ['bg-red-500', 'md:bg-clip-text', 'text-transparent'],
      MD_UP,
    ],
    [
      'arbitrary paint',
      ['bg-[url(/a.png)]', 'bg-clip-text', 'text-transparent'],
      ALL,
    ],
    [
      'legacy gradient',
      ['bg-gradient-to-r', 'from-red-500', 'bg-clip-text', 'text-transparent'],
      ALL,
    ],
    [
      'white beats transparent',
      ['bg-white', 'bg-transparent', 'bg-clip-text', 'text-transparent'],
      ALL,
    ],
    [
      'gradient paints despite transparent color',
      [
        'bg-linear-to-r',
        'from-red-500',
        'bg-transparent',
        'bg-clip-text',
        'text-transparent',
      ],
      ALL,
    ],
    [
      'cross-layer painted stop',
      ['bg-linear-to-r', 'md:from-red-500', 'bg-clip-text', 'text-transparent'],
      MD_UP,
    ],
    [
      'via channel paints',
      ['bg-linear-to-r', 'via-red-500', 'bg-clip-text', 'text-transparent'],
      ALL,
    ],
    [
      'stop position does not blank',
      [
        'bg-linear-to-r',
        'from-blue-500',
        'from-75%',
        'bg-clip-text',
        'text-transparent',
      ],
      ALL,
    ],
  ])('pairs a clip with an effective background: %s', (_, classes, expected) => {
    expect(textColorMarkers(classes).clippedAt).toEqual(expected);
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
    [
      'transparent beats solid',
      ['bg-red-500', 'bg-transparent', 'bg-clip-text', 'text-transparent'],
    ],
    [
      'zero-alpha beats solid',
      ['bg-red-500', 'bg-white/0', 'bg-clip-text', 'text-transparent'],
    ],
    [
      'same-layer responsive conflict',
      [
        'md:bg-red-500',
        'md:bg-transparent',
        'bg-clip-text',
        'text-transparent',
      ],
    ],
    [
      'transparent beats theme',
      ['bg-foreground', 'bg-transparent', 'bg-clip-text', 'text-transparent'],
    ],
    [
      'transparent beats red stop',
      [
        'bg-linear-to-r',
        'from-red-500',
        'from-transparent',
        'to-transparent',
        'bg-clip-text',
        'text-transparent',
      ],
    ],
    [
      'zero-alpha beats red stop',
      [
        'bg-linear-to-r',
        'from-red-500',
        'from-red-500/0',
        'bg-clip-text',
        'text-transparent',
      ],
    ],
    [
      'same-layer responsive stop conflict',
      [
        'bg-linear-to-r',
        'md:from-red-500',
        'md:from-transparent',
        'bg-clip-text',
        'text-transparent',
      ],
    ],
  ])('withholds pairing without both sides: %s', (_, classes) => {
    expect(textColorMarkers(classes).clippedAt).toEqual(NONE);
  });
});
