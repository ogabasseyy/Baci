import { expect, it } from 'vitest';
import { createTransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
import { sweepExperienceOutputs } from './job-sweeper';

it('sweeps expired job output without dropping a later output', () => {
  const store = createTransientOutputStore();
  const old = store.put('expired', 0);
  const fresh = store.put('fresh', 86400000);
  sweepExperienceOutputs(store, 86400001);
  expect(() => store.read(old, 86400001)).toThrow('NOT_FOUND');
  expect(store.read(fresh, 86400001)).toBe('fresh');
});
