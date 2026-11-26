import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiPost: post, apiGet: get }));

import { ExperienceVerificationRetry } from './verification-retry';

afterEach(() => {
  cleanup();
  post.mockReset();
  get.mockReset();
  vi.useRealTimers();
});
it('reads the committed receipt until verification is complete without sending another mutation', async () => {
  vi.useFakeTimers();
  get
    .mockResolvedValueOnce({ status: 'verifying' })
    .mockResolvedValueOnce({ status: 'live' });
  render(<ExperienceVerificationRetry approvalId="existing-id" />);
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByRole('status')).toHaveTextContent('verifying');
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByRole('status')).toHaveTextContent('live');
  expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledWith(
    '/api/builder-experience/approval?approval=existing-id&kind=lifecycle',
    expect.objectContaining({ cache: 'no-store' })
  );
  expect(post).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(get).toHaveBeenCalledTimes(2);
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
