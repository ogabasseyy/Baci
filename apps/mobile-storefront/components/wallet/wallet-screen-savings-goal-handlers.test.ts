import { describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { Product } from '@/types/product';
import {
  changeSavingsGoalDevice,
  createSavingsVariantResolutionHandler,
} from './wallet-screen-savings.handlers';
import { createSavingsGoalContentHandlers } from './wallet-screen-savings-goal-handlers';

jest.mock('./wallet-screen-savings.handlers', () => ({
  changeSavingsGoalDevice: jest.fn(async () => true),
  createSavingsVariantResolutionHandler: jest.fn(() => jest.fn()),
}));

const goal = { id: 'goal-1' } as WalletActiveSavingsGoal;

describe('createSavingsGoalContentHandlers', () => {
  it('binds the device change to the active goal and merchant', async () => {
    const refetchWallet = jest.fn(async () => undefined);
    const { onChangeSavingsDevice } = createSavingsGoalContentHandlers({
      activeMerchantId: 'merchant-1',
      activeMerchantSlug: 'shop',
      goal,
      refetchWallet,
    });
    const product = { id: 'product-1' } as Product;

    await expect(onChangeSavingsDevice(product, 'variant-1')).resolves.toBe(
      true
    );
    expect(changeSavingsGoalDevice).toHaveBeenCalledWith({
      activeMerchantId: 'merchant-1',
      activeMerchantSlug: 'shop',
      goal,
      product,
      refetchWallet,
      variantId: 'variant-1',
    });
  });

  it('builds the variant resolver from the same goal context', () => {
    const refetchWallet = jest.fn(async () => undefined);
    createSavingsGoalContentHandlers({ goal, refetchWallet });

    expect(createSavingsVariantResolutionHandler).toHaveBeenCalledWith({
      goal,
      refetchWallet,
    });
  });
});
