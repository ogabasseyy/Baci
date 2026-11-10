import { expect, it, vi } from 'vitest';
import { readExperienceAuthoringMode } from './authoring-mode';

it('accepts only explicit legacy/full-code metadata and fails closed on unknown/error', async () => {
  for (const value of ['legacy', 'full-code', null, true, 'unknown']) {
    const rpc = vi.fn(async () => ({ data: value, error: null }));
    expect(
      await readExperienceAuthoringMode({ rpc } as never, 'merchant')
    ).toBe(value === 'legacy' || value === 'full-code' ? value : 'unavailable');
  }
  const rpc = vi.fn(async () => {
    throw Error('unavailable');
  });
  expect(await readExperienceAuthoringMode({ rpc } as never, 'merchant')).toBe(
    'unavailable'
  );
});
