import { expect, it } from 'vitest';
import * as oxygen from './oxygen-follow-up';

it('exports the Oxygen queue validation contracts', () => {
  expect(Object.keys(oxygen).sort()).toEqual([
    'extractBoundedArray',
    'oxygenFollowUpCandidateSchema',
    'oxygenFollowUpCandidatesSchema',
    'oxygenFollowUpMerchantSchema',
    'oxygenFollowUpOrderSchema',
    'oxygenFollowUpOrdersSchema',
    'oxygenFollowUpStatusSchema',
  ]);
});
