// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

import { checkRateLimit } from '@/lib/rate-limit';
import {
  admitPublicExperienceRead,
  parseExperiencePublicRequest,
} from './public-request';

it('rejects route traversal and uses standard anonymous rate limiting with no cart provisioning', async () => {
  expect(() =>
    parseExperiencePublicRequest({
      buildDigest: 'a'.repeat(64),
      path: '/../checkout',
    })
  ).toThrow();
  await admitPublicExperienceRead('resolved', {} as never);
  expect(checkRateLimit).toHaveBeenCalledWith({}, '/api/storefront/experience');
});

it('rejects anonymous experience reads when the limiter denies admission', async () => {
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as never);
  expect(await admitPublicExperienceRead('resolved', {} as never)).toBe(false);
});
