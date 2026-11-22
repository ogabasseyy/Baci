import { oxygenSelfieExpiresAt } from './oxygen-selfie-expiry';

const link = (payload: unknown) =>
  `https://selfie.example/?securityToken=a.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c`;
it('reads expiry as a recovery hint, never proof of verification', () => {
  expect(oxygenSelfieExpiresAt(link({ exp: 1800000000 }))).toBe(1800000000000);
});
it.each([
  undefined,
  'invalid',
  'https://selfie.example',
  link({ exp: '1800000000' }),
  link({ exp: -1 }),
  link({ exp: 1e100 }),
])('leaves unavailable or malformed expiry unknown', (value) => {
  expect(oxygenSelfieExpiresAt(value)).toBeNull();
});
