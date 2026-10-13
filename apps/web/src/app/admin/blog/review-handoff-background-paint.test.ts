import { describe, expect, it } from 'vitest';
import { backgroundPaintAt } from './review-handoff-background-paint';

const ALL = [true, true, true, true, true, true];
const NONE = [false, false, false, false, false, false];
const MD_UP = [false, false, true, true, true, true];
const BELOW_MD = [true, true, false, false, false, false];

describe('backgroundPaintAt', () => {
  it.each([
    [['bg-linear-to-r', 'from-red-500', 'to-orange-500'], ALL],
    [['bg-red-500'], ALL],
    [['bg-store-primary'], ALL],
    [['md:bg-red-500'], MD_UP],
    [['bg-[url(/a.png)]'], ALL],
    [['bg-gradient-to-r', 'from-red-500'], ALL],
    [['bg-white', 'bg-transparent'], ALL],
    [['bg-linear-to-r', 'from-red-500', 'bg-transparent'], ALL],
    [['bg-linear-to-r', 'md:from-red-500'], MD_UP],
    [['bg-linear-to-r', 'via-red-500'], ALL],
    [['bg-linear-to-r', 'from-blue-500', 'from-75%'], ALL],
    [['bg-red-500', 'bg-none'], ALL],
    [['bg-[url(/a.png)]', 'md:bg-none'], BELOW_MD],
    [['bg-transparent', 'bg-red-500!'], ALL],
    [['md:bg-transparent', 'bg-red-500!'], ALL],
    [['bg-red-500', 'md:bg-transparent!'], BELOW_MD],
  ])('reports a painted background: %s', (classes, expected) => {
    expect(backgroundPaintAt(classes)).toEqual(expected);
  });

  it.each([
    [[]],
    [['bg-none']],
    [['bg-transparent']],
    [['bg-red-500/0']],
    [['bg-linear-to-r']],
    [['bg-linear-to-r', 'from-transparent']],
    [['bg-red-500', 'bg-transparent']],
    [['bg-red-500', 'bg-white/0']],
    [['md:bg-red-500', 'md:bg-transparent']],
    [['bg-foreground', 'bg-transparent']],
    [['bg-linear-to-r', 'from-red-500', 'from-transparent', 'to-transparent']],
    [['bg-linear-to-r', 'from-red-500', 'from-red-500/0']],
    [['bg-linear-to-r', 'md:from-red-500', 'md:from-transparent']],
    [['bg-[length:100px]']],
    [['bg-clip-text']],
    [['bg-red-500', 'bg-transparent!']],
  ])('reports no paint without an effective background: %s', (classes) => {
    expect(backgroundPaintAt(classes)).toEqual(NONE);
  });
});
