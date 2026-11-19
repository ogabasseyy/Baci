import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenProvider } from './provider';

it.each([
  '  WE HAVE SENT THE ACCOUNT LINKING DETAILS TO LINK YOUR ACCOUNT TO YOUR EMAIL  ',
  'We have sent the account linking details\n to link your account to your email!',
])('recognizes harmless variations in the account-link email response', async (message) => {
  const provider = createOxygenProvider({
    environment: 'production',
    token: async () => 'private',
    fetch: async () => Response.json({ message }, { status: 400 }),
  });
  await expect(provider.call('eligibility', {})).rejects.toMatchObject({
    outcome: 'rejected',
    code: 'OXYGEN_STATEMENT_LINK_SENT',
  });
});

it('does not claim an email was sent when the provider says it was not', async () => {
  const provider = createOxygenProvider({
    environment: 'production',
    token: async () => 'private',
    fetch: async () =>
      Response.json(
        {
          message:
            'We have not sent the account linking details to link your account to your email.',
        },
        { status: 400 }
      ),
  });
  await expect(provider.call('eligibility', {})).rejects.toMatchObject({
    outcome: 'rejected',
    code: undefined,
  });
});

it('does not apply the eligibility message to a booking rejection', async () => {
  const provider = createOxygenProvider({
    environment: 'production',
    token: async () => 'private',
    fetch: async () =>
      Response.json(
        {
          message:
            'We have sent the account linking details to link your account to your email.',
        },
        { status: 400 }
      ),
  });
  await expect(provider.call('book', {})).rejects.toMatchObject({
    outcome: 'rejected',
    code: undefined,
  });
});
