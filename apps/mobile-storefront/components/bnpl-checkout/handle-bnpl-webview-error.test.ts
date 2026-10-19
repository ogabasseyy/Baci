import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { handleBNPLWebViewError } from './handle-bnpl-webview-error';

const mockLogDebug = jest.fn();
jest.mock('./bnpl-checkout-message-handler', () => ({
  logBNPLCheckoutDebug: (...args: unknown[]) => mockLogDebug(...args),
}));

describe('handleBNPLWebViewError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears the timeout, marks error, and surfaces the provider message', () => {
    const clearPendingLoadTimeout = jest.fn();
    const setCheckoutStatus = jest.fn<(status: 'error') => void>();
    const setErrorMessage = jest.fn<(message: string) => void>();

    handleBNPLWebViewError(
      { description: 'net::ERR_FAILED', url: 'https://pay.example/x' },
      clearPendingLoadTimeout,
      setCheckoutStatus,
      setErrorMessage
    );

    expect(clearPendingLoadTimeout).toHaveBeenCalledTimes(1);
    expect(setCheckoutStatus).toHaveBeenCalledWith('error');
    expect(setErrorMessage).toHaveBeenCalledWith('net::ERR_FAILED');
  });

  it('falls back to a generic message without a provider description', () => {
    const setErrorMessage = jest.fn<(message: string) => void>();

    handleBNPLWebViewError(
      {},
      jest.fn(),
      jest.fn<(status: 'error') => void>(),
      setErrorMessage
    );

    expect(setErrorMessage).toHaveBeenCalledWith('Failed to load payment page');
  });
});
