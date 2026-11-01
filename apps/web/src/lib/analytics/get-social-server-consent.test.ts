import { expect, it } from 'vitest';
import { getSocialServerConsent } from './get-social-server-consent';

it('does not assume marketing consent during server rendering', () => {
  expect(getSocialServerConsent()).toBe(false);
});
