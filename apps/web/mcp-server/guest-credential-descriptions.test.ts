import { expect, it } from 'vitest';
import { guestCredentialDescriptions } from './guest-credential-descriptions';

it('guides an uncertain first add without promising it can be replayed', () => {
  expect(guestCredentialDescriptions.update).toContain('If the first add returns no credential, do not retry automatically');
  expect(guestCredentialDescriptions.read).toContain('Never repeat an add or removal to refresh a link');
});
