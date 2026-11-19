/** Shared fixtures for the Change phone step tests. */
import { jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { Product } from '@/types/product';
import { SavingsPhoneSwapStep } from './SavingsPhoneSwapStep';
export const iphone: Product = {
  condition: 'Used',
  id: 'product-1',
  image: 'https://cdn.example.com/iphone.jpg',
  name: 'iPhone 15 Pro',
  price: 700000,
  slug: 'iphone-15-pro',
  variants: [
    {
      attributes: { storage: '256GB' },
      condition: 'used' as const,
      id: 'variant-256',
      image: 'https://cdn.example.com/iphone-256.jpg',
      name: '256GB',
      price: 650000,
    },
    {
      attributes: { storage: '128GB' },
      condition: 'used' as const,
      id: 'variant-128',
      image: 'https://cdn.example.com/iphone-128.jpg',
      name: '128GB',
      price: 100000,
    },
  ],
};

export const goal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 120000,
  id: 'goal-1',
  maturity_date: '2999-01-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Sandbox Test Phone',
} satisfies WalletActiveSavingsGoal;

export function renderStep(
  over: Partial<Parameters<typeof SavingsPhoneSwapStep>[0]['swap']> = {},
  savedGoal: WalletActiveSavingsGoal = goal
) {
  const swap = {
    handleSelectSavingsDevice: jest.fn(async () => undefined),
    isChangingSavingsDevice: false,
    isSavingsDeviceLoading: false,
    resolveProduct: jest.fn(async (product: Product) => product),
    savingsDeviceProducts: [iphone],
    savingsDeviceSearch: 'iphone',
    setSavingsDeviceSearch: jest.fn(),
    setShowSavingsDeviceSwap: jest.fn(),
    ...over,
  };
  const view = render(
    <SavingsPhoneSwapStep colors={Colors.light} goal={savedGoal} swap={swap} />
  );
  return { swap, view };
}
