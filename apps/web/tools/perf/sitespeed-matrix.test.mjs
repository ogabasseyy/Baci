import { expect, it } from 'vitest';
import { validateMatrix } from './sitespeed-matrix.mjs';

const valid = {
  coldRuns: 3,
  profiles: ['mobile'],
  routes: [{ family: 'home', path: '/' }],
};
it('accepts a nonempty valid matrix', () =>
  expect(validateMatrix(valid)).toBe(valid));
it('rejects empty, malformed, duplicate or unsafe matrix entries', () => {
  for (const patch of [
    { coldRuns: 0 },
    { coldRuns: -1 },
    { coldRuns: 1.5 },
    { coldRuns: undefined },
    { routes: [] },
    { profiles: [] },
    { profiles: ['typo'] },
    { profiles: ['mobile', 'mobile'] },
    { routes: [{ family: '../escape', path: '/' }] },
    { routes: [{ family: 'home', path: '//other.test' }] },
    { routes: [valid.routes[0], valid.routes[0]] },
  ])
    expect(() => validateMatrix({ ...valid, ...patch })).toThrow(
      /invalid route matrix/
    );
});
