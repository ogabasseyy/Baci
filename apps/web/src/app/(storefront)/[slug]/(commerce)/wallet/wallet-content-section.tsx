import Link from 'next/link';
import { OgabasseyV2Wallet } from '@/components/storefront/ogabassey/pages/wallet';
import { SavingsScreen } from '@/components/storefront/piggyvest-savings/savings-screen';
import { asRoute } from '@/lib/routes';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { LocalSavingsWallet } from './local-savings-wallet';

interface WalletContentSectionProps {
  giftCardsHref?: string;
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
      {props.giftCardsHref && (
        <nav
          aria-label="Wallet Services"
          className="mx-auto max-w-2xl px-4 py-4"
        >
          <h2 className="font-semibold">Wallet Services</h2>
          <Link
            href={asRoute(props.giftCardsHref)}
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Gift Cards
          </Link>
        </nav>
      )}
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
