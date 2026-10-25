import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

import { OxygenActivationTrial } from './OxygenActivationTrial';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows the requested staging note and activates once on an explicit click', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ status: 'ready', result: {} }))
    .mockResolvedValue(
      Response.json({ status: 'activated', result: { status: 'ACTIVATED' } })
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <OxygenActivationTrial reference="438f96ee-37c4-49bb-a56c-51451f9cb624" />
  );
  const button = await screen.findByRole('button', {
    name: 'Confirm payment and activate',
  });
  expect(
    screen.getByText(/Payment confirmation should automatically activate/i)
  ).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(button);
  await screen.findByText('Payment plan activated');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole('button', { name: 'Confirm payment and activate' })
  ).toBeNull();
});
it('does not enable a trial for another booking', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<OxygenActivationTrial reference="other" />);
  await waitFor(() => expect(fetcher).not.toHaveBeenCalled());
  expect(screen.queryByRole('button')).toBeNull();
});
