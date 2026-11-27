import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NetworkError } from '@/lib/api-errors';

vi.mock('@/lib/api-client', async () => {
  const errors = await import('@/lib/api-errors');
  return { NetworkError: errors.NetworkError };
});

import { InboxLoadError } from './InboxLoadError';

const show = (error: unknown, onRetry = vi.fn()) => {
  render(
    <InboxLoadError colors={LIGHT_COLORS} error={error} onRetry={onRetry} />
  );
  return onRetry;
};

describe('InboxLoadError', () => {
  it.each([
    [403, 'You do not have permission to read customer messages.'],
    [404, 'Messages are not set up for this store yet.'],
    [500, 'Could not load messages. Please try again.'],
  ])('explains a %i answer', (statusCode, message) => {
    show(new NetworkError('no', { statusCode }));

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('retries when asked', () => {
    const onRetry = show(new Error('down'));

    fireEvent.click(screen.getByRole('button', { name: 'Tap to retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
