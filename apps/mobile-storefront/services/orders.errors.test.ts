import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiError, RetryExhaustedError } from '@/lib/api';

const mockLoggerWarn = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: mockLoggerWarn,
  }),
}));

jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
}));

// Import the module under test LAZILY (after the mock-capturing consts above
// have initialized), so `@/lib/logger`'s mock factory sees a defined
// mockLoggerWarn. A static top-level import would load orders.errors — and run
// createLogger() — before those consts exist.
function loadOrdersErrors() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./orders.errors') as typeof import('./orders.errors');
}

describe('orders.errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getValidationErrorMessage — quiz voucher rejections', () => {
    it('maps a route-level UPPER_CASE voucher code to friendly copy', () => {
      // /api/orders returns a generic top-level error + the specific code.
      const message = loadOrdersErrors().getValidationErrorMessage(
        'Failed to create order',
        'QUIZ_VOUCHER_MULTIPLE'
      );
      expect(message).toMatch(/only one prize voucher/i);
      expect(message).not.toBe('Failed to create order');
    });

    it('maps a DB RPC lower_case voucher reason to friendly copy', () => {
      const message = loadOrdersErrors().getValidationErrorMessage(
        'Failed to create order',
        'quiz_voucher_award_not_found'
      );
      expect(message).toMatch(/couldn't find this prize/i);
    });

    it('maps an expired-token code and prefers the details code over the error', () => {
      expect(
        loadOrdersErrors().getValidationErrorMessage(
          'Failed to create order',
          'QUIZ_VOUCHER_TOKEN_EXPIRED'
        )
      ).toMatch(/expired/i);
    });

    it('falls back to the raw error when no code is known', () => {
      expect(
        loadOrdersErrors().getValidationErrorMessage(
          'Something odd happened',
          undefined
        )
      ).toBe('Something odd happened');
    });
  });

  it('redacts raw API error bodies from retry diagnostics', () => {
    const apiError = new ApiError(
      {
        status: 503,
        statusText: 'Service Unavailable',
      } as Response,
      {
        error: 'Provider failed',
        customer_email: 'buyer@example.com',
        customer_phone: '+2348012345678',
      }
    );
    const retryError = new RetryExhaustedError(3, apiError);

    loadOrdersErrors().mapCreateOrderException(retryError, Date.now());

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Create order request failed before retry completion',
      expect.objectContaining({
        lastError: expect.objectContaining({
          body: '[REDACTED]',
          status: 503,
          statusText: 'Service Unavailable',
        }),
      })
    );
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lastError: expect.objectContaining({
          body: expect.objectContaining({
            customer_phone: expect.any(String),
          }),
        }),
      })
    );
  });

  it('does not include sensitive raw API error fields in retry diagnostics', () => {
    const apiError = new ApiError(
      {
        status: 502,
        statusText: 'Bad Gateway',
      } as Response,
      {
        error: 'Gateway failed',
        customer_email: 'buyer@example.com',
        customer_phone: '+2348012345678',
      }
    );
    const retryError = new RetryExhaustedError(2, apiError);

    loadOrdersErrors().mapCreateOrderException(retryError, Date.now());

    const diagnostics = mockLoggerWarn.mock.calls[0]?.[1] as {
      lastError?: { body?: unknown };
    };

    expect(diagnostics.lastError?.body).toBe('[REDACTED]');
    expect(JSON.stringify(diagnostics)).not.toContain('buyer@example.com');
    expect(JSON.stringify(diagnostics)).not.toContain('+2348012345678');
  });

  it('does not map a deferred queued-owner mismatch into an order failure', () => {
    const { DeferredOfflineMutationError } =
      require('@/lib/deferred-offline-mutation-error') as typeof import('@/lib/deferred-offline-mutation-error');
    expect(() =>
      loadOrdersErrors().mapCreateOrderException(
        new DeferredOfflineMutationError(
          'Queued checkout belongs to a different account'
        ),
        Date.now()
      )
    ).toThrow(DeferredOfflineMutationError);
  });
});
