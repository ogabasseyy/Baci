import { expect, it, vi } from 'vitest';
import { reportCartCookieStorageFailure } from './cart-cookie-storage-failure';

it('does not report a failure when epoch storage works', () => {
  const dispatch = vi.fn();
  expect(reportCartCookieStorageFailure(dispatch, 1)).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
});
it('reports unavailable storage for the pending operation', () => {
  const denied = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(() => {
      throw new Error('denied');
    });
  try {
    const dispatch = vi.fn();
    expect(reportCartCookieStorageFailure(dispatch, 1, 'op')).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      generation: 1,
      type: 'command/failed',
      operationId: 'op',
      code: 'temporarily_unavailable',
      retryable: true,
    });
  } finally {
    denied.mockRestore();
  }
});
