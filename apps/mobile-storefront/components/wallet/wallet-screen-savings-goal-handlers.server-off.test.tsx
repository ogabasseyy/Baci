import { describe, expect, it, jest } from '@jest/globals';
import { createSavingsGoalContentHandlers } from './wallet-screen-savings-goal-handlers';

jest.mock('./wallet-screen-savings.handlers', () => ({
  changeSavingsGoalDevice: jest.fn(async () => false),
  createSavingsVariantResolutionHandler: jest.fn(() => jest.fn()),
}));

// Pure delegation: with the server off these are the production handlers.
describe('savings goal content handlers with the server off', () => {
  it('still exposes both callbacks WalletContent expects', () => {
    const handlers = createSavingsGoalContentHandlers({
      goal: null,
      refetchWallet: async () => undefined,
    });

    expect(typeof handlers.onChangeSavingsDevice).toBe('function');
    expect(typeof handlers.onResolveSavingsVariant).toBe('function');
  });
});
