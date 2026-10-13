import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockWarn = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

const { clearLastNotificationResponse } =
  require('./clear-last-notification-response') as typeof import('./clear-last-notification-response');

describe('clearLastNotificationResponse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears the native response when the module is available', () => {
    const clear = jest.fn();

    const result = clearLastNotificationResponse({
      clearLastNotificationResponse: clear,
    });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('keeps response processing safe when native clearing fails', () => {
    const clear = jest.fn(() => {
      throw new Error('notifications unavailable');
    });

    const result = clearLastNotificationResponse({
      clearLastNotificationResponse: clear,
    });

    expect(result).toBe(false);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});
