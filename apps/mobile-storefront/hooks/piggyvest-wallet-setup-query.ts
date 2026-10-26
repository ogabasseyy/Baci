import AsyncStorage from '@react-native-async-storage/async-storage';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { PIGGYVEST_WALLET_SETUP as policy } from '@/config/piggyvest-wallet-setup';
import { rollbackObservedCapabilityOnNotReady } from '@/lib/piggyvest-primary-capability';
import { observePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';
import { piggyvestPrimaryWalletApi as api } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';

export type PiggyvestWalletSetupSnapshot = Awaited<
  ReturnType<typeof api.read>
> & {
  attempted: boolean;
  completedSetup: boolean;
};

export function piggyvestWalletSetupQuery(
  client: QueryClient,
  merchantId: string,
  userId: string
) {
  const queryKey = ['piggyvest-wallet-setup', merchantId, userId];
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }): Promise<PiggyvestWalletSetupSnapshot> => {
      const attempted =
        (await AsyncStorage.getItem(
          `${policy.storagePrefix}${merchantId}:${userId}`
        )) === 'pending';
      try {
        const snapshot = await api.read(merchantId, userId, signal);
        if (signal.aborted || useAuthStore.getState().user?.id !== userId)
          throw new Error('The signed-in account changed.');
        observePiggyvestPrimaryCapability(merchantId, true);
        if (snapshot.account || snapshot.provisioningStatus === 'not_started')
          await AsyncStorage.removeItem(
            `${policy.storagePrefix}${merchantId}:${userId}`
          ).catch(() => undefined);
        return {
          ...snapshot,
          attempted:
            !snapshot.account &&
            snapshot.provisioningStatus !== 'not_started' &&
            attempted,
          completedSetup:
            !!snapshot.account &&
            (attempted ||
              client.getQueryData<PiggyvestWalletSetupSnapshot>(queryKey)
                ?.completedSetup === true),
        };
      } catch (error) {
        if (!signal.aborted && useAuthStore.getState().user?.id === userId) {
          rollbackObservedCapabilityOnNotReady(merchantId, error);
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'PROFILE_VERIFICATION_REQUIRED'
          )
            observePiggyvestPrimaryCapability(merchantId, true);
        }
        throw error;
      }
    },
    staleTime: (current) =>
      current.state.data?.account
        ? policy.readyStaleTimeMs
        : policy.pollingIntervalMs,
    gcTime: policy.cacheTimeMs,
    retry: 1,
    retryDelay: 1000,
  });
}
