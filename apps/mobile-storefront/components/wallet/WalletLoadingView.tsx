import type { ComponentProps } from 'react';
import type { useWalletScreenData } from './use-wallet-screen-data';
import { WalletScreenView } from './WalletScreenView';
import { getWalletLoadingMessage } from './wallet-screen.helpers';

export function WalletLoadingView({
  query,
  user,
  hasMerchantContext,
  ...view
}: {
  query: Pick<
    ReturnType<typeof useWalletScreenData>,
    'data' | 'balancePreview' | 'isError' | 'isLoading' | 'refetch'
  >;
  user: unknown;
  hasMerchantContext: boolean;
} & Pick<ComponentProps<typeof WalletScreenView>, 'colors' | 'presentation'>) {
  return (
    <WalletScreenView
      {...view}
      balancePreview={
        user && hasMerchantContext ? query.balancePreview : undefined
      }
      isError={query.isError}
      onRetry={() => {
        void query.refetch().catch(() => undefined);
      }}
      loadingMessage={getWalletLoadingMessage({
        user,
        hasMerchantContext,
        hasWalletData: !!query.data,
        isError: query.isError,
        isLoading: query.isLoading,
      })}
    />
  );
}
