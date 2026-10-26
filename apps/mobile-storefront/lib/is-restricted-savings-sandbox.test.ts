import { isRestrictedSavingsSandbox } from './is-restricted-savings-sandbox';

it.each([
  [
    '1',
    'https://staging.ogabassey.com',
    'https://staging-auth.ogabassey.com',
    true,
  ],
  [
    '0',
    'https://staging.ogabassey.com',
    'https://staging-auth.ogabassey.com',
    false,
  ],
  ['1', 'https://ogabassey.com', 'https://staging-auth.ogabassey.com', false],
  [
    '1',
    'https://staging.ogabassey.com',
    'https://production.supabase.co',
    false,
  ],
])('limits restricted behavior to the pinned savings sandbox: %s %s %s', (mode, api, auth, expected) => {
  expect(
    isRestrictedSavingsSandbox({
      hostedMode: mode as string,
      apiUrl: api as string,
      authUrl: auth as string,
    })
  ).toBe(expected);
});
