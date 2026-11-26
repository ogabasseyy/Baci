import { render, screen } from '@testing-library/react';
import { isValidElement, Suspense } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const {
  getUser,
  getAuthorizationDetails,
  approveAuthorization,
  denyAuthorization,
  getOrigin,
  notFound,
  redirect,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
  getOrigin: vi.fn(),
  notFound: vi.fn(() => {
    throw Error('not-found');
  }),
  redirect: vi.fn((target: string) => {
    throw Error(target);
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: getOrigin() }),
}));
vi.mock('next/navigation', () => ({ notFound, redirect }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser,
      oauth: {
        getAuthorizationDetails,
        approveAuthorization,
        denyAuthorization,
      },
    },
  }),
}));

import { decideBuilderOAuthAuthorization } from './actions';
import { BuilderOAuthConsent } from './builder-oauth-consent';
import BuilderOAuthAuthorization from './page';

const authorizationId = '5deac4bd-8179-40c7-ae8c-869fa2f7a926';
const clientId = 'c913932b-a768-41a0-8c2a-9f749a63abee';
const actorUserId = 'a6b7fb66-ced9-4eca-9373-3c543e031cd3';
const otherId = 'e84bb1fa-2c5a-42cc-9432-dd43eb2ae48d';
const callback = 'https://builder-auth.usebaci.com/upstream/callback';
const upstream = 'https://project.supabase.co';
const consentDetails = {
  authorization_id: authorizationId,
  redirect_uri: callback,
  client: { id: clientId, name: 'Upstream metadata' },
  user: { id: actorUserId, email: 'private@example.com' },
  scope: 'openid',
};

function page(value: string | string[] = authorizationId) {
  return BuilderOAuthConsent({
    searchParams: Promise.resolve({ authorization_id: value }),
  });
}

function decision(choice: string, value = authorizationId) {
  const formData = new FormData();
  formData.set('authorizationId', value);
  formData.set('decision', choice);
  return decideBuilderOAuthAuthorization(formData);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('BACI_BUILDER_UPSTREAM_OAUTH_CLIENT_ID', clientId);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', upstream);
  getOrigin.mockReturnValue('https://usebaci.com');
  getUser.mockResolvedValue({
    data: { user: { id: actorUserId } },
    error: null,
  });
  getAuthorizationDetails.mockResolvedValue({
    data: consentDetails,
    error: null,
  });
});

it('keeps request-time consent work below the prerender Suspense boundary', () => {
  const result = BuilderOAuthAuthorization({
    searchParams: Promise.resolve({ authorization_id: authorizationId }),
  });
  expect(result.type).toBe(Suspense);
  const child: unknown = result.props.children;
  expect(isValidElement(child) && child.type).toBe(BuilderOAuthConsent);
  expect(getUser).not.toHaveBeenCalled();
});

it('sends signed-out users through the normal login flow with the validated consent return path', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(page()).rejects.toThrow('/login?');
  const login = new URL(redirect.mock.calls[0][0], 'https://usebaci.com');
  expect(login.searchParams.get('redirect')).toBe(
    `/auth/builder-oauth/authorize?authorization_id=${authorizationId}`
  );
  expect(getAuthorizationDetails).not.toHaveBeenCalled();
});

it('shows the consent prompt without exposing upstream user or client fields', async () => {
  render(await page());
  expect(screen.getByRole('button', { name: 'Verify account' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Decline' })).toBeVisible();
  expect(screen.queryByText('private@example.com')).toBeNull();
  expect(screen.queryByText('Upstream metadata')).toBeNull();
  expect(getUser).toHaveBeenCalledBefore(getAuthorizationDetails);
});

it.each([
  { client: { id: otherId } },
  { user: { id: otherId } },
  { redirect_uri: 'https://example.com/callback' },
  { scope: 'openid email' },
])('does not display or approve invalid consent details %j', async (changed) => {
  getAuthorizationDetails.mockResolvedValue({
    data: { ...consentDetails, ...changed },
    error: null,
  });
  await expect(page()).rejects.toThrow('not-found');
  await expect(decision('approve')).rejects.toThrow('not-found');
  expect(approveAuthorization).not.toHaveBeenCalled();
});

it('blocks bad IDs, duplicate query IDs and cross-origin actions before authorization lookup', async () => {
  await expect(page([authorizationId, authorizationId])).rejects.toThrow(
    'not-found'
  );
  await expect(decision('approve', 'bad')).rejects.toThrow('not-found');
  getOrigin.mockReturnValue('https://example.com');
  await expect(decision('approve')).rejects.toThrow('not-found');
  expect(getAuthorizationDetails).not.toHaveBeenCalled();
  expect(approveAuthorization).not.toHaveBeenCalled();
});

it('approves only after rereading the authorization and redirects to the trusted callback', async () => {
  const destination = `${callback}?code=test&state=test`;
  approveAuthorization.mockResolvedValue({
    data: { redirect_url: destination },
  });
  await expect(decision('approve')).rejects.toThrow(destination);
  expect(getAuthorizationDetails).toHaveBeenCalledBefore(approveAuthorization);
  expect(approveAuthorization).toHaveBeenCalledWith(authorizationId, {
    skipBrowserRedirect: true,
  });
  expect(denyAuthorization).not.toHaveBeenCalled();
});

it('denies only after rereading the authorization and rejects an untrusted callback', async () => {
  denyAuthorization.mockResolvedValue({
    data: { redirect_url: 'https://example.com/other?error=access_denied' },
  });
  await expect(decision('deny')).rejects.toThrow('not-found');
  expect(denyAuthorization).toHaveBeenCalledWith(authorizationId, {
    skipBrowserRedirect: true,
  });
  expect(approveAuthorization).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

it('resumes an already-approved GoTrue request through the dedicated callback without approving it again', async () => {
  const destination = `${callback}?code=test&state=test&iss=${encodeURIComponent(`${upstream}/auth/v1`)}`;
  getAuthorizationDetails.mockResolvedValue({
    data: { redirect_url: destination },
    error: null,
  });
  await expect(page()).resolves.toBeDefined();
  expect(redirect).not.toHaveBeenCalled();
  await expect(decision('deny')).rejects.toThrow('not-found');
  await expect(decision('approve')).rejects.toThrow(destination);
  expect(approveAuthorization).not.toHaveBeenCalled();
  expect(denyAuthorization).not.toHaveBeenCalled();
});

it.each([
  'malformed',
  'https://unrelated.example/upstream/callback?code=test&state=test',
  'https://user@builder-auth.usebaci.com/upstream/callback?code=test&state=test',
  `${callback}?code=test&state=test#fragment`,
  `${callback}?code=test&code=another&state=test`,
  `${callback}?code=test&state=test&state=another`,
  `${callback}?code=test&state=`,
  `${callback}?state=test&error=access_denied`,
  `${callback}?code=test&state=test&iss=https%3A%2F%2Fother.example%2Fauth%2Fv1`,
  `${callback}?code=test&state=test&iss=`,
])('rejects an invalid pre-approved callback %s', async (destination) => {
  getAuthorizationDetails.mockResolvedValue({
    data: { redirect_url: destination },
    error: null,
  });
  await expect(page()).rejects.toThrow('not-found');
  expect(redirect).not.toHaveBeenCalled();
});

it('rejects an issuer mismatch on the fresh approval redirect too', async () => {
  approveAuthorization.mockResolvedValue({
    data: {
      redirect_url: `${callback}?code=test&state=test&iss=https%3A%2F%2Fbuilder-auth.usebaci.com`,
    },
  });
  await expect(decision('approve')).rejects.toThrow('not-found');
  expect(redirect).not.toHaveBeenCalled();
});

it('returns a denial through the dedicated callback', async () => {
  const destination = `${callback}?error=access_denied&state=test`;
  denyAuthorization.mockResolvedValue({ data: { redirect_url: destination } });
  await expect(decision('deny')).rejects.toThrow(destination);
  expect(approveAuthorization).not.toHaveBeenCalled();
});
