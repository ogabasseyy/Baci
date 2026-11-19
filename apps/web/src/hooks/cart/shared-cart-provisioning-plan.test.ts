import { beforeEach, expect, it, vi } from 'vitest';
import { getCartFromStorage, getSharedCartImportReceipt } from './cart-storage';
import { cartItem, snapshot } from './shared-cart-provisioning.test-support';
import { planProvisioningImport } from './shared-cart-provisioning-plan';

vi.mock('./cart-storage', () => ({
  getCartFromStorage: vi.fn(),
  getSharedCartImportReceipt: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSharedCartImportReceipt).mockReturnValue(null as never);
});

it('plans a legacy import from the parked cache for a fresh cart', () => {
  vi.mocked(getCartFromStorage).mockReturnValue([cartItem()] as never);
  const plan = planProvisioningImport('shop', {
    confirmed: null,
    importStatus: 'none',
  } as never);
  expect(plan.isTerminalReset).toBe(false);
  expect(plan.planned).not.toBeNull();
  expect(plan.cached).toHaveLength(1);
});

it('does not re-plan while an import is already pending', () => {
  vi.mocked(getCartFromStorage).mockReturnValue([cartItem()] as never);
  const plan = planProvisioningImport('shop', {
    confirmed: null,
    importStatus: 'pending',
  } as never);
  expect(plan.planned).toBeNull();
});

it('detects a terminal reset from the confirmed snapshot', () => {
  vi.mocked(getCartFromStorage).mockReturnValue([] as never);
  const plan = planProvisioningImport('shop', {
    confirmed: snapshot({ state: 'completed' }),
    importStatus: 'skipped',
  } as never);
  expect(plan.isTerminalReset).toBe(true);
});
