import { expect, it } from 'vitest';
import {
  upstreamApprovedRedirect,
  upstreamAuthorizationConsent,
  upstreamAuthorizationDecision,
  upstreamAuthorizationId,
} from './builder-upstream-oauth';

const id = '11111111-1111-4111-8111-111111111111';
const redirect =
  'https://builder-auth.synthetic.test/oauth/callback?code=synthetic';

it('accepts UUID authorization identifiers and the two consent decisions', () => {
  expect(upstreamAuthorizationId.parse(id)).toBe(id);
  expect(upstreamAuthorizationId.safeParse('invalid').success).toBe(false);
  for (const decision of ['approve', 'deny']) {
    expect(
      upstreamAuthorizationDecision.parse({ authorizationId: id, decision })
    ).toEqual({ authorizationId: id, decision });
  }
  expect(
    upstreamAuthorizationDecision.safeParse({
      authorizationId: id,
      decision: 'allow',
    }).success
  ).toBe(false);
  expect(
    upstreamAuthorizationDecision.safeParse({
      authorizationId: 1,
      decision: 'deny',
    }).success
  ).toBe(false);
});

it('requires a valid upstream authorization, redirect, client, user and exact OpenID scope', () => {
  const consent = {
    authorization_id: id,
    redirect_uri: redirect,
    client: { id },
    user: { id },
    scope: 'openid',
  };
  expect(upstreamAuthorizationConsent.parse(consent)).toEqual(consent);
  for (const override of [
    { authorization_id: '' },
    { redirect_uri: '/relative' },
    { client: { id: 'invalid' } },
    { user: { id: 'invalid' } },
    { scope: 'openid offline_access' },
    { scope: ['openid'] },
  ]) {
    expect(
      upstreamAuthorizationConsent.safeParse({ ...consent, ...override })
        .success
    ).toBe(false);
  }
});

it('accepts only a bounded absolute URL in the approved redirect payload', () => {
  expect(upstreamApprovedRedirect.parse({ redirect_url: redirect })).toEqual({
    redirect_url: redirect,
  });
  for (const value of [
    { redirect_url: '/relative' },
    { redirect_url: redirect.padEnd(8193, 'a') },
    { redirect_url: redirect, unexpected: true },
    { redirect_uri: redirect },
  ]) {
    expect(upstreamApprovedRedirect.safeParse(value).success).toBe(false);
  }
});
