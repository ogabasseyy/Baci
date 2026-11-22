import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStart = jest.fn<() => Promise<void>>();
const mockStop = jest.fn<() => Promise<void>>();
const mockGetSessionId = jest.fn<() => string>();
jest.mock('./analytics-core', () => ({
  getPostHog: () => ({
    getSessionId: mockGetSessionId,
    startSessionRecording: mockStart,
    stopSessionRecording: mockStop,
  }),
}));

async function settleTransitions() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

describe('native checkout replay', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    mockGetSessionId.mockReturnValue('checkout-session');
    mockStart.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);
  });

  it('keeps an excluded session excluded when checkout is reopened', async () => {
    const random = jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0);
    try {
      const { startCheckoutReplay } = await import('./checkout-replay');
      expect(startCheckoutReplay()).toBeUndefined();
      expect(startCheckoutReplay()).toBeUndefined();
      await settleTransitions();
      expect(random).toHaveBeenCalledTimes(1);
      expect(mockStart).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it('stops after a pending native start finishes when checkout has closed', async () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { startCheckoutReplay } = await import('./checkout-replay');
      let finishStart: () => void = () => {};
      mockStart.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
      );
      const stop = startCheckoutReplay();
      await settleTransitions();
      expect(mockStart).toHaveBeenCalledTimes(1);
      stop?.();
      expect(mockStop).toHaveBeenCalledTimes(1);
      finishStart();
      await settleTransitions();
      expect(mockStop).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
    }
  });
});
