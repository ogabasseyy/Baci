import type { readPiggyvestSavingsView } from '@/lib/piggyvest/savings-view';

type ServerDecision = Extract<
  Awaited<ReturnType<typeof readPiggyvestSavingsView>>,
  { status: 'ready' }
>['decision'];

export type CustomerSavingsStatusProps = {
  device: {
    productName: string;
    variant: string | null;
    condition: string;
  };
} & (
  | { status: 'loading' | 'unavailable' | 'pending_wallet' }
  | {
      status: 'ready';
      decision: Pick<
        ServerDecision,
        | 'purchasingPowerKobo'
        | 'devicePriceKobo'
        | 'readiness'
        | 'purchaseAction'
      >;
      pendingInterestKobo: number | null;
      actionPending: boolean;
      onReviewPurchase: () => void;
    }
);
