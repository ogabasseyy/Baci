import { useQuery } from '@tanstack/react-query';
import { useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { listSavedVtuCards } from '@/lib/vtu-checkout';

export function useWalletSavedCards(customerId?: string, merchantId?: string) {
  const navigation = useNavigation();
  const enabled = Boolean(customerId && merchantId);
  const { data, isError, refetch } = useQuery({
    queryKey: ['wallet-saved-cards', merchantId, customerId],
    queryFn: ({ signal }) => listSavedVtuCards({ signal }),
    enabled,
    retry: false,
    staleTime: 0,
  });
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (enabled) void refetch();
      }),
    [navigation, enabled, refetch]
  );
  return enabled && !isError && Boolean(data?.length);
}
