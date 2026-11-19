import { expect, it } from 'vitest';
import { buildSickwLookupData } from './imei-sickw-lookup-data';

it('preserves zero and defaults only an absent score', () => {
  expect(buildSickwLookupData('123', { score: 0 }, {}).score).toBe(0);
  expect(buildSickwLookupData('123', {}, {}).score).toBe(50);
});
