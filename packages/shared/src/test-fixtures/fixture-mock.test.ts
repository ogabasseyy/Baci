import { describe, expect, it } from 'vitest';
import { createFixtureMock } from './fixture-mock';

describe('createFixtureMock', () => {
  it('tracks calls, results, and invocation order', () => {
    const fn = createFixtureMock((n: number) => n * 2);
    expect(fn(2)).toBe(4);
    expect(fn(3)).toBe(6);
    expect(fn.mock.calls).toEqual([[2], [3]]);
    expect(fn.mock.results).toEqual([
      { type: 'return', value: 4 },
      { type: 'return', value: 6 },
    ]);
    expect(fn.mock.invocationCallOrder).toHaveLength(2);
    expect(fn._isMockFunction).toBe(true);
    expect(fn.getMockName()).toBe('fixtureMock');
  });

  it('mockClear keeps once-queue; mockReset drops implementation', () => {
    const fn = createFixtureMock(() => 'base');
    fn.mockReturnValueOnce('once');
    fn.mockClear();
    expect(fn.mock.calls).toEqual([]);
    expect(fn()).toBe('once');
    fn.mockReset();
    expect(fn()).toBeUndefined();
  });

  it('records sync throws as throw results', () => {
    const fn = createFixtureMock(() => {
      throw new Error('boom');
    });
    expect(() => fn()).toThrow('boom');
    expect(fn.mock.results).toEqual([
      { type: 'throw', value: expect.any(Error) },
    ]);
  });
});
