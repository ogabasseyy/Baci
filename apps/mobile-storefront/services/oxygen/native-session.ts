import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { getOxygenMobileProfile } from '@/lib/oxygen-mobile-profile';
import { assertOxygenCapabilities } from '@/lib/oxygen-staging-profile';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { createOxygenClient } from './client';
import { OxygenIntentJournal } from './journal';
import { findOwnedOxygenWorkflowId } from './owned-workflow';
import { createOxygenSessionReader } from './session-reader';
import { createOxygenWorkflow } from './workflow';

/** Scope every request to the independently hydrated storefront customer. */
export function oxygenNativeSession() {
  const configuredProfile = getOxygenMobileProfile();
  if (!configuredProfile)
    throw new Error('Oxygen checkout is unavailable in this app');
  const profile = configuredProfile;
  const owner = () => {
    const state = useAuthStore.getState();
    return {
      userId: state.user?.id ?? null,
      customer: state.customer
        ? {
            id: state.customer.id,
            user_id: state.customer.user_id ?? null,
            merchant_id: state.customer.merchant_id ?? '',
          }
        : null,
    };
  };
  const initialOwner = owner();
  if (
    !initialOwner.customer ||
    initialOwner.customer.user_id !== initialOwner.userId ||
    initialOwner.customer.merchant_id !== profile.merchantId
  )
    throw new Error('Oxygen requires a linked customer account');
  const customerId = initialOwner.customer.id;
  const userId = initialOwner.userId;
  if (!userId) throw new Error('Sign in to continue Oxygen checkout');
  const isCurrentOwner = () => {
    const current = owner();
    return (
      current.userId === userId &&
      current.customer?.id === customerId &&
      current.customer.user_id === userId &&
      current.customer.merchant_id === profile.merchantId
    );
  };
  const client = createOxygenClient({
    profile,
    fetch: globalThis.fetch,
    getSession: createOxygenSessionReader(
      supabase.auth,
      userId,
      isCurrentOwner
    ),
  });
  async function capabilities(newInitiation: boolean) {
    const dto = await client.capabilities();
    if (!isCurrentOwner()) throw new Error('Oxygen session changed');
    return assertOxygenCapabilities(profile, dto, owner(), newInitiation);
  }
  return {
    client,
    profile,
    userId,
    capabilities,
    workflow: (orderId: string) =>
      createOxygenWorkflow({
        client,
        environment: profile.environment,
        findSaved: async (ownedOrderId) => {
          if (!isCurrentOwner()) return null;
          const id = await findOwnedOxygenWorkflowId(
            ownedOrderId,
            customerId,
            profile.merchantId,
            profile.environment
          );
          return isCurrentOwner() ? id : null;
        },
        journal: new OxygenIntentJournal(AsyncStorage, {
          storageKey: profile.storagePrefix,
          userId,
          merchantId: profile.merchantId,
          orderId,
        }),
        key: randomUUID,
      }),
  };
}
