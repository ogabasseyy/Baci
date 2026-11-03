// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('@/lib/rate-limit', () => ({
  getTrustedClientIdentifier: () => 'synthetic-public-IP',
}));

import { checkCartQuota } from '@/lib/cart/request-quota';
import {
  admitPublicExperienceRead,
  parseExperiencePublicRequest,
} from './public-request';

it('rejects route traversal and uses a separate hashed quota subject with no cart provisioning', async () => {
  expect(() =>
    parseExperiencePublicRequest({
      buildDigest: 'a'.repeat(64),
      path: '/../checkout',
    })
  ).toThrow();
  await admitPublicExperienceRead('resolved', {} as never);
  expect(checkCartQuota).toHaveBeenCalledWith({
    merchantId: 'resolved',
    operation: 'snapshot',
    subject: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});
