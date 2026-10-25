import { afterEach, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('Not found');
  },
}));
vi.mock('@/components/payments/oxygen/OxygenPaymentSuccessPreview', () => ({
  OxygenPaymentSuccessPreview: () => null,
}));

import Page from './page';

afterEach(() => vi.unstubAllEnvs());
it.each([
  'production',
  'test',
])('does not expose the fixed success fixture in %s', (mode) => {
  vi.stubEnv('NODE_ENV', mode);
  expect(() => Page()).toThrow('Not found');
});
it('permits the fixture only in the development runtime', () => {
  vi.stubEnv('NODE_ENV', 'development');
  expect(Page()).toBeTruthy();
});
