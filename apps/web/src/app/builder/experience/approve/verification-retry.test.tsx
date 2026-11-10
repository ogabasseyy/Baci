import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiPost: post }));

import { ExperienceVerificationRetry } from './verification-retry';

afterEach(() => {
  cleanup();
  post.mockReset();
});
it('retries only the existing approval receipt, including repeated transient verification results', async () => {
  post
    .mockResolvedValueOnce({ status: 'verifying' })
    .mockResolvedValueOnce({ status: 'live' });
  render(<ExperienceVerificationRetry approvalId="existing-id" />);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry verification' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Retry verification' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry verification' }));
  await screen.findByText('live');
  expect(post).toHaveBeenCalledTimes(2);
  for (const [path, body] of post.mock.calls) {
    expect(path).toBe('/api/builder-experience/approval');
    expect(body).toEqual({
      action: 'confirm-publication',
      approvalId: 'existing-id',
    });
  }
  expect(screen.queryByRole('button')).toBeNull();
});
it('allows retry after a verification transport failure', async () => {
  post
    .mockRejectedValueOnce(Error('synthetic'))
    .mockResolvedValueOnce({ status: 'live' });
  render(<ExperienceVerificationRetry approvalId="same" />);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText(
    'Verification unavailable. You can retry verification.'
  );
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('live');
});
