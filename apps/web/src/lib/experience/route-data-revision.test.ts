import { expect, it } from 'vitest';
import { selectTrustedExperienceCheckout } from './route-data-revision';

it('uses existing functional checkout for full code even when legacy selector is a demo', () => {
  expect(
    selectTrustedExperienceCheckout(
      { template_id: 'new-template' },
      { buildDigest: 'verified' }
    )
  ).toBe('engine');
  expect(
    selectTrustedExperienceCheckout({ template_id: 'new-template' }, null)
  ).toBe('legacy-demo');
  expect(
    selectTrustedExperienceCheckout({ template_id: 'ogabassey' }, null)
  ).toBe('engine');
});
