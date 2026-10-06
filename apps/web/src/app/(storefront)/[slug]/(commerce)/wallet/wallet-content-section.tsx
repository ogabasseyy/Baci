import { OgabasseyV2Wallet } from '@/components/storefront/ogabassey/pages/wallet';
import { SavingsScreen } from '@/components/storefront/piggyvest-savings/savings-screen';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { LocalSavingsWallet } from './local-savings-wallet';

interface WalletContentSectionProps {
  initialShowFunding?: boolean;
  initialShowUsdtFunding?: boolean;
  initialUsdtAmount?: number;
  initialUsdtReference?: string;
  usdtWalletEnabled?: boolean;
  stagingSavings?: unknown;
  localSavings?: { merchantId: string; merchantSlug: string };
}

export function WalletContentSection(props: WalletContentSectionProps) {
  const {
    initialShowFunding = false,
    initialShowUsdtFunding = false,
    initialUsdtAmount,
    initialUsdtReference,
    usdtWalletEnabled = false,
    stagingSavings,
    localSavings,
  } = props;
  const stagingSelected = Object.hasOwn(props, 'stagingSavings');
  const parsed = stagingSelected
    ? piggyvestSavingsScreenSchema.safeParse(stagingSavings)
    : null;
  const stagingSource = parsed?.success
    ? parsed.data
    : { environment: 'staging' as const, status: 'unavailable' as const };
  return (
    <section aria-labelledby="wallet-page-title">
      <h1 id="wallet-page-title" className="sr-only">
        Wallet Balance
      </h1>
      {stagingSelected ? (
        <SavingsScreen source={stagingSource} />
      ) : localSavings ? (
        <LocalSavingsWallet {...localSavings} />
      ) : (
        <OgabasseyV2Wallet
          initialShowFunding={initialShowFunding}
          initialShowUsdtFunding={initialShowUsdtFunding}
          initialUsdtAmount={initialUsdtAmount}
          initialUsdtReference={initialUsdtReference}
          usdtWalletEnabled={usdtWalletEnabled}
        />
      )}
    </section>
  );
}
