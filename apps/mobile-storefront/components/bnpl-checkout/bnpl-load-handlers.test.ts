import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createBNPLLoadHandlers } from './bnpl-load-handlers';
import type { BNPLCheckoutStatus } from './use-bnpl-checkout-controller';

function createInput(status: BNPLCheckoutStatus) {
  const statusRef = { current: status };
  const input = {
    clearPendingLoadTimeout: jest.fn(),
    scheduleLoadTimeout: jest.fn(),
    setCheckoutStatus:
      jest.fn<
        (
          status:
            | BNPLCheckoutStatus
            | ((current: BNPLCheckoutStatus) => BNPLCheckoutStatus)
        ) => void
      >(),
    setErrorMessage: jest.fn<(message: string | null) => void>(),
    statusRef,
  };
  return { ...createBNPLLoadHandlers(input), input };
}

describe('createBNPLLoadHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts loading and schedules the timeout from a fresh state', () => {
    const { handleLoadStart, input } = createInput('ready');

    handleLoadStart();

    expect(input.setErrorMessage).toHaveBeenCalledWith(null);
    expect(input.scheduleLoadTimeout).toHaveBeenCalledTimes(1);
    expect(input.setCheckoutStatus).toHaveBeenCalledWith('loading');
  });

  it('ignores load start once the checkout reached a terminal status', () => {
    for (const status of ['error', 'success'] as const) {
      const { handleLoadStart, input } = createInput(status);

      handleLoadStart();

      expect(input.scheduleLoadTimeout).not.toHaveBeenCalled();
      expect(input.setCheckoutStatus).not.toHaveBeenCalled();
    }
  });

  it('clears the timeout and returns to ready on load end', () => {
    const { handleLoadEnd, input } = createInput('loading');

    handleLoadEnd();

    expect(input.clearPendingLoadTimeout).toHaveBeenCalledTimes(1);
    const transition = input.setCheckoutStatus.mock.calls[0][0] as (
      current: BNPLCheckoutStatus
    ) => BNPLCheckoutStatus;
    expect(transition('loading')).toBe('ready');
  });

  it('preserves terminal statuses on load end', () => {
    for (const status of ['error', 'success'] as const) {
      const { handleLoadEnd, input } = createInput(status);

      handleLoadEnd();

      const transition = input.setCheckoutStatus.mock.calls[0][0] as (
        current: BNPLCheckoutStatus
      ) => BNPLCheckoutStatus;
      expect(transition(status)).toBe(status);
    }
  });
});
