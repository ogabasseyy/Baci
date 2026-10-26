import { useWallet } from '@/hooks/use-wallet';

export function useWalletScreenData() {
  return {
    ...useWallet({
      cachePolicy: 'display',
      navigationRefresh: 'numbers',
      progressive: true,
    }),
    refreshState: undefined,
  };
}
