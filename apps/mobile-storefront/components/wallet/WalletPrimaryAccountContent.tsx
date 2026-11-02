import { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { useAuthStore } from '@/stores/auth-store';
import { WalletContent, type WalletContentProps } from './WalletContent';

function ConnectedWalletContent(
  props: WalletContentProps & { merchantId: string; userId: string }
) {
  const primarySetup = usePiggyvestWalletSetup(props.merchantId, props.userId);
  return (
    <WalletContent
      {...props}
      primarySetup={primarySetup}
      fundingAccount={
        primarySetup.account ??
        (props.fundingAccount?.provider === 'piggyvest'
          ? props.fundingAccount
          : null)
      }
    />
  );
}

export function WalletPrimaryAccountContent(props: WalletContentProps) {
  const capability = usePiggyvestPrimaryCapability(props.merchantId);
  const userId = useAuthStore((state) => state.user?.id);
  if (capability === null)
    return (
      <WalletContent
        {...props}
        fundingAccount={null}
        primaryCapabilityPending
      />
    );
  if (capability !== true || !props.merchantId || !userId)
    return <WalletContent {...props} />;
  return (
    <ConnectedWalletContent
      key={`${props.merchantId}:${userId}`}
      {...props}
      merchantId={props.merchantId}
      userId={userId}
    />
  );
}
