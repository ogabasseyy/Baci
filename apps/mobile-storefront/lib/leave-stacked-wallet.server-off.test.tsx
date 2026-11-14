import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { leaveStackedWallet } from './leave-stacked-wallet';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = false;
jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    canGoBack: () => mockCanGoBack,
    replace: (href: string) => mockReplace(href),
  },
}));

beforeEach(() => {
  mockBack.mockClear();
  mockReplace.mockClear();
});

describe('bugfix: stacked wallet page after sign-in has no way out', () => {
  it('falls back to the Wallet tab when there is no history', () => {
    mockCanGoBack = false;

    leaveStackedWallet();

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/wallet');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('goes back normally when there is a screen underneath', () => {
    mockCanGoBack = true;

    leaveStackedWallet();

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
