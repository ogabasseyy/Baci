import { describe, expect, it } from 'vitest';
import { scaleMarkers } from './review-handoff-scale-markers';

// Per-point zero flags as six chars: base, sm, md, lg, xl, 2xl.
describe('scaleMarkers', () => {
  it.each([
    ['lone axis zero', ['scale-x-0'], 'TTTTTT', 'FFFFFF'],
    ['bare zero', ['scale-0'], 'TTTTTT', 'TTTTTT'],
    ['numeric winner', ['scale-x-0', 'scale-x-100'], 'FFFFFF', 'FFFFFF'],
    ['axis beats bare', ['scale-0', 'scale-x-100'], 'FFFFFF', 'TTTTTT'],
    ['none beats zero', ['scale-x-0', 'scale-none'], 'FFFFFF', 'FFFFFF'],
    ['static zero', ['scale-[0]'], 'TTTTTT', 'TTTTTT'],
    ['none beats static', ['scale-[0]', 'scale-none'], 'FFFFFF', 'FFFFFF'],
    ['static beats axis', ['scale-x-100', 'scale-[0]'], 'TTTTTT', 'TTTTTT'],
    ['negative sorts first', ['scale-x-0', '-scale-x-100'], 'TTTTTT', 'FFFFFF'],
    [
      'arbitrary beats numeric',
      ['scale-x-[0]', 'scale-x-100'],
      'TTTTTT',
      'FFFFFF',
    ],
    ['axis beats bare numeric', ['scale-y-0', 'scale-100'], 'FFFFFF', 'TTTTTT'],
    ['unresolved arbitrary', ['scale-x-[var(--x)]'], 'FFFFFF', 'FFFFFF'],
    ['noise ignored', ['scale-foo', 'scale-x-0'], 'TTTTTT', 'FFFFFF'],
    ['responsive restore', ['scale-x-0', 'md:scale-x-100'], 'TTFFFF', 'FFFFFF'],
    ['responsive none', ['scale-0', 'md:scale-none'], 'TTFFFF', 'TTFFFF'],
    ['responsive zero', ['scale-x-0', 'md:scale-x-0'], 'TTTTTT', 'FFFFFF'],
    ['responsive-only zero', ['md:scale-x-0'], 'FFTTTT', 'FFFFFF'],
    [
      'cross-layer fallthrough',
      ['scale-0', 'md:scale-x-100'],
      'TTFFFF',
      'TTTTTT',
    ],
    ['dimensionless restore', ['scale-x-0', 'md:scale-3d'], 'TTTTTT', 'FFFFFF'],
    ['lone dimension switch', ['md:scale-3d'], 'FFFFFF', 'FFFFFF'],
    ['responsive static', ['scale-x-100', 'md:scale-[0]'], 'FFTTTT', 'FFTTTT'],
    [
      'static yields upward',
      ['scale-[0]', 'md:scale-x-100'],
      'TTFFFF',
      'TTFFFF',
    ],
    ['narrow restore', ['scale-x-0', 'max-md:scale-x-100'], 'FFTTTT', 'FFFFFF'],
  ])('%s: %s', (_name, classes, expectedX, expectedY) => {
    const markers = scaleMarkers(classes as string[]);
    expect(
      markers.scaleXZeroAt.map((zero) => (zero ? 'T' : 'F')).join('')
    ).toBe(expectedX);
    expect(
      markers.scaleYZeroAt.map((zero) => (zero ? 'T' : 'F')).join('')
    ).toBe(expectedY);
  });
});
