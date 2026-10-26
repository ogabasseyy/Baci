jest.mock('../lib/account-deletion', () => ({
  getDeleteAccountErrorMessage: jest.fn(() => 'Deletion unavailable'),
}));
jest.mock('../lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
}));
jest.mock('../lib/push-token-storage', () => ({
  getStoredPushToken: jest.fn(),
}));
jest.mock('../lib/query-cache-observer-safety', () => ({
  clearQueryCachePreservingObservers: jest.fn(),
}));
jest.mock('../lib/query-client', () => ({ queryClient: {} }));
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn() },
    rpc: jest.fn(),
  },
}));
jest.mock('../services/savings-activity-lifecycle', () => ({
  setSavingsActivityOwner: jest.fn(),
}));
jest.mock('./auth-store-account-date-of-birth', () => ({
  createDateOfBirthAction: () => ({}),
}));
jest.mock('./auth-store-account-profile', () => ({
  createProfileActions: () => ({}),
}));
jest.mock('./auth-store-push', () => ({
  clearLocalAndDeactivatePushToken: jest.fn(),
}));
jest.mock('./cart-store', () => ({
  useCartStore: { setState: jest.fn() },
}));
jest.mock('./clear-device-cart', () => ({
  clearDeviceCartForAccountTeardown: jest.fn(),
}));
jest.mock('./comparison-store', () => ({
  useComparisonStore: { getState: () => ({ clearComparison: jest.fn() }) },
}));
jest.mock('./quiz-store', () => ({
  useQuizStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('./saved-store', () => ({
  useSavedStore: { getState: () => ({ clearSaved: jest.fn() }) },
}));
jest.mock('./shared-cart-writer', () => ({
  retireSharedCartWriter: jest.fn(() => Promise.resolve()),
}));

import { getStoredPushToken } from '../lib/push-token-storage';
import { supabase } from '../lib/supabase';
import { setSavingsActivityOwner } from '../services/savings-activity-lifecycle';
import type { AuthState } from './auth-store.types';
import { createAccountActions } from './auth-store-account';
import { clearLocalAndDeactivatePushToken } from './auth-store-push';

const tokenRead = getStoredPushToken as jest.MockedFunction<
  typeof getStoredPushToken
>;
const ownerFence = setSavingsActivityOwner as jest.MockedFunction<
  typeof setSavingsActivityOwner
>;
const rpc = supabase.rpc as jest.Mock;
const providerSignOut = supabase.auth.signOut as jest.Mock;
const clearPush = clearLocalAndDeactivatePushToken as jest.Mock;

function makeActions(subscription: AuthState['_authSubscription'] = null) {
  const state = {
    user: { app_metadata: { providers: ['password'] } },
    _authSubscription: subscription,
  } as AuthState;
  const set = jest.fn((next: Partial<AuthState>) => Object.assign(state, next));
  const get = () => state;
  return { actions: createAccountActions(set, get), set, state };
}

describe('account savings activity ownership fences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenRead.mockResolvedValue(null);
    clearPush.mockResolvedValue(undefined);
    providerSignOut.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ error: null });
  });

  it('fences synchronously on explicit signout without a subscription, even when provider signout fails', async () => {
    const order: string[] = [];
    ownerFence.mockImplementation(() => order.push('fence'));
    tokenRead.mockImplementation(async () => {
      order.push('first await');
      return null;
    });
    providerSignOut.mockResolvedValueOnce({ error: { message: 'offline' } });
    const { actions } = makeActions(null);

    await actions.signOut();

    expect(order.slice(0, 2)).toEqual(['fence', 'first await']);
    expect(ownerFence).toHaveBeenCalledWith(null);
    expect(providerSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('fences after successful deletion and before the first teardown await', async () => {
    const order: string[] = [];
    ownerFence.mockImplementation(() => order.push('fence'));
    tokenRead.mockImplementation(async () => {
      order.push('first teardown await');
      return null;
    });
    const { actions } = makeActions();

    const result = await actions.deleteAccount();

    expect(result).toEqual({ success: true, usedApple: false });
    expect(order).toEqual(['fence', 'first teardown await']);
    expect(rpc).toHaveBeenCalledWith('delete_current_storefront_account');
  });

  it('never fences when account deletion fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'foreign key constraint' } });
    const { actions } = makeActions();

    const result = await actions.deleteAccount();

    expect(result).toEqual({ success: false, error: 'Deletion unavailable' });
    expect(ownerFence).not.toHaveBeenCalled();
    expect(tokenRead).not.toHaveBeenCalled();
    expect(providerSignOut).not.toHaveBeenCalled();
  });
});
