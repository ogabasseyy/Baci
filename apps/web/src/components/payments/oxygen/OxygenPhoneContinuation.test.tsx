import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));

import { OxygenPhoneContinuation } from './OxygenPhoneContinuation';

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => window.history.replaceState(null, '', '/'));
it('clears the capability fragment and displays a recovery message without retrying the link', async () => {
  window.history.replaceState(
    null,
    '',
    `/auth/oxygen-selfie#${'t'.repeat(43)}`
  );
  m.fetch.mockResolvedValue(new Response('{}', { status: 410 }));
  render(<OxygenPhoneContinuation />);
  expect(window.location.hash).toBe('');
  expect(
    await screen.findByRole('heading', { name: 'Scan a new QR code' })
  ).toBeVisible();
  expect(m.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Return to your other device'
  );
});
it('rejects missing tokens locally without requesting a worker or provider', async () => {
  window.history.replaceState(null, '', '/auth/oxygen-selfie');
  render(<OxygenPhoneContinuation />);
  await screen.findByRole('heading', { name: 'Scan a new QR code' });
  expect(m.fetch).not.toHaveBeenCalled();
});
it('sends the rendered page allowlist with the one-time capability', async () => {
  window.history.replaceState(
    null,
    '',
    `/auth/oxygen-selfie#${'t'.repeat(43)}`
  );
  m.fetch.mockResolvedValue(new Response('{}', { status: 410 }));
  render(
    <OxygenPhoneContinuation selfieOrigins={['https://selfie.example.test']} />
  );
  await screen.findByRole('heading', { name: 'Scan a new QR code' });
  const [, options] = m.fetch.mock.calls[0];
  expect(JSON.parse(options.body)).toEqual({
    token: 't'.repeat(43),
    selfieOrigins: ['https://selfie.example.test'],
  });
});
it('keeps a request failure recoverable and ignores unsafe returned URLs', async () => {
  window.history.replaceState(
    null,
    '',
    `/auth/oxygen-selfie#${'t'.repeat(43)}`
  );
  m.fetch.mockResolvedValue(Response.json({ url: 'javascript:alert(1)' }));
  render(<OxygenPhoneContinuation />);
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Scan a new QR code' })
    ).toBeVisible()
  );
  expect(window.location.pathname).toBe('/auth/oxygen-selfie');
});

it('rejects an HTTPS phone redirect outside the configured selfie origins', async () => {
  window.history.replaceState(
    null,
    '',
    `/auth/oxygen-selfie#${'t'.repeat(43)}`
  );
  m.fetch.mockResolvedValue(
    Response.json({ url: 'https://evil.example.test/selfie' })
  );
  render(<OxygenPhoneContinuation />);
  expect(
    await screen.findByRole('heading', { name: 'Scan a new QR code' })
  ).toBeVisible();
  expect(window.location.pathname).toBe('/auth/oxygen-selfie');
});

it.each([
  410, 503,
])('does not claim expiry when redemption returns %s', async (status) => {
  window.history.replaceState(
    null,
    '',
    `/auth/oxygen-selfie#${'t'.repeat(43)}`
  );
  m.fetch.mockResolvedValue(new Response('{}', { status }));
  render(<OxygenPhoneContinuation />);
  const notice = await screen.findByRole('status');
  await waitFor(() =>
    expect(notice).toHaveTextContent('We couldn’t open this link')
  );
  expect(notice).not.toHaveTextContent(/expired|already used/i);
  expect(notice).toHaveTextContent('generate a new QR code');
  expect(m.fetch).toHaveBeenCalledTimes(1);
});
it('does not claim expiry when the network outcome is unknown', async () => {
  window.history.replaceState(
    null,
    '',
    `/auth/oxygen-selfie#${'t'.repeat(43)}`
  );
  m.fetch.mockRejectedValue(new Error('offline'));
  render(<OxygenPhoneContinuation />);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'We couldn’t open this link'
    )
  );
  expect(screen.getByRole('status')).not.toHaveTextContent(
    /expired|already used/i
  );
  expect(m.fetch).toHaveBeenCalledTimes(1);
});
