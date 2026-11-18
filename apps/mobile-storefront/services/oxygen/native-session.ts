import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import {
  assertOxygenStagingCapabilities,
  getOxygenStagingProfile,
} from '@/lib/oxygen-staging-profile';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { createOxygenClient } from './client';
import { OxygenIntentJournal } from './journal';
import { createOxygenSessionReader } from './session-reader';
import { createOxygenWorkflow } from './workflow';

/** Scope every request to the independently hydrated staging customer. */
export function oxygenNativeSession() {
  const configuredProfile = getOxygenStagingProfile();
  if (!configuredProfile)
    throw new Error('Oxygen checkout requires the isolated staging app');
  const profile = configuredProfile;
  const owner = () => {
    const state = useAuthStore.getState();
    return {
      userId: state.user?.id ?? null,
      customer: state.customer
        ? {
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
    throw new Error('Oxygen requires a linked staging customer');
  const userId = initialOwner.userId;
  if (!userId) throw new Error('Sign in to the staging merchant to continue');
  const client = createOxygenClient({
    profile,
    fetch: globalThis.fetch,
    getSession: createOxygenSessionReader(
      supabase.auth,
      userId,
      () => owner().userId === userId
    ),
  });
  async function capabilities(newInitiation: boolean) {
    const dto = await client.capabilities();
    if (owner().userId !== userId) throw new Error('Oxygen session changed');
    return assertOxygenStagingCapabilities(
      profile,
      dto,
      owner(),
      newInitiation
    );
  }
  return {
    client,
    profile,
    userId,
    capabilities,
    workflow: (orderId: string) =>
      createOxygenWorkflow({
        client,
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
