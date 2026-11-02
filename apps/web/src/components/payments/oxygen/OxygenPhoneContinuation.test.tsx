import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: m.fetch }));

import { OxygenPhoneContinuation } from './OxygenPhoneContinuation';

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => window.history.replaceState(null, '', '/'));
it('clears the capability fragment and displays a recovery message without retrying an expired link', async () => {
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
