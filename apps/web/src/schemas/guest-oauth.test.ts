import { expect, it } from 'vitest';
import {
  guestOAuthAuthorizationSchema,
  guestOAuthCartInputSchema,
  guestOAuthCartOutputSchema,
  guestOAuthExchangeSchema,
  guestOAuthRegistrationSchema,
  guestOAuthWorkerClaimsSchema,
} from './guest-oauth';

const request = {
  client_id: 'public-client',
  redirect_uri: 'https://chatgpt.com/callback',
  resource: 'https://qa.example.com/mcp',
  response_type: 'code',
  scope: 'cart:write',
  code_challenge_method: 'S256',
  code_challenge: 'a'.repeat(43),
};
it('accepts S256 authorization and rejects weaker or additional scopes', () => {
  expect(guestOAuthAuthorizationSchema.safeParse(request).success).toBe(true);
  expect(
    guestOAuthAuthorizationSchema.safeParse({
      ...request,
      code_challenge_method: 'plain',
    }).success
  ).toBe(false);
  expect(
    guestOAuthAuthorizationSchema.safeParse({
      ...request,
      scope: 'orders:write',
    }).success
  ).toBe(false);
});
it('requires a bounded verifier and opaque code', () => {
  expect(
    guestOAuthExchangeSchema.safeParse({
      ...request,
      code: 'a'.repeat(64),
      code_verifier: 'b'.repeat(43),
    }).success
  ).toBe(true);
  expect(
    guestOAuthExchangeSchema.safeParse({
      ...request,
      code: 'short',
      code_verifier: 'short',
    }).success
  ).toBe(false);
});
it('permits a removal without model-held authority and strips an injected selector', () => {
  const parsed = guestOAuthCartInputSchema.parse({
    product_id: '11111111-1111-4111-8111-111111111111',
    quantity: 0,
    cart_token: 'a'.repeat(64),
  });
  expect(parsed).not.toHaveProperty('cart_token');
});
it('requires connected replies to carry their handoff fields and no cart capability', () => {
  const reply = guestOAuthCartOutputSchema.parse({
    success: true,
    connection_bound: true,
    items: [],
    expires_at: '2099-01-01T00:00:00.000Z',
    cart_url: 'https://ogabassey.com/cart',
    cart_token: 'a'.repeat(64),
  });
  expect(reply).not.toHaveProperty('cart_token');
  expect(
    guestOAuthCartOutputSchema.safeParse({
      success: true,
      connection_bound: true,
    }).success
  ).toBe(false);
});
it('accepts only the dedicated worker role and public PKCE client registration', () => {
  expect(
    guestOAuthWorkerClaimsSchema.safeParse({
      role: 'service_role',
      merchant_id: '11111111-1111-4111-8111-111111111111',
      exp: 1,
    }).success
  ).toBe(false);
  expect(
    guestOAuthRegistrationSchema.safeParse({
      redirect_uris: ['https://chatgpt.com/callback'],
      token_endpoint_auth_method: 'none',
    }).success
  ).toBe(true);
  expect(
    guestOAuthRegistrationSchema.safeParse({
      redirect_uris: ['https://chatgpt.com/callback'],
      grant_types: ['client_credentials'],
    }).success
  ).toBe(false);
});
