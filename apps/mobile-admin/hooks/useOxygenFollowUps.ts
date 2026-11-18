import { useQuery } from '@tanstack/react-query';
import { fetchOxygenFollowUps } from './fetchOxygenFollowUps';
import { useMerchant } from './useMerchant';

export function useOxygenFollowUps() {
  const { merchant } = useMerchant();
  const query = useQuery({
    queryKey: ['oxygen-follow-ups', merchant?.id],
    queryFn: () => {
      if (!merchant?.id) throw new Error('Merchant ID is required');
      return fetchOxygenFollowUps(merchant.id);
    },
    enabled: Boolean(merchant?.id),
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });
  return {
    ...query,
    data: query.data?.orders,
    isIncomplete: query.data?.isIncomplete ?? false,
  };
}
