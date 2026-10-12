import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { PurchaseSuccess } from '@/components/utilities/PurchaseSuccess';
import type Colors from '@/constants/Colors';
import {
  useVtuVoucherPinBackfill,
  type VtuBackfillTerminalStatus,
} from '@/hooks/use-vtu-voucher-pin-backfill';
import { utilityPurchaseStyles as styles } from './utility-purchase.styles';
import type {
  UtilityPurchaseResult,
  ValidUtilityType,
} from './utility-purchase.types';

type UtilityPurchaseSuccessData = Omit<
  UtilityPurchaseResult,
  'cashback' | 'voucherPin'
> & {
  cashback?: UtilityPurchaseResult['cashback'] | null;
  voucherPin?: string | null;
};

interface UtilityPurchaseSuccessViewProps {
  colors: typeof Colors.light | typeof Colors.dark;
  data: UtilityPurchaseSuccessData;
  headerOffset: number;
  isAuthenticated: boolean;
  onCreateAccount: () => void;
  /** Fires once when polling observes the purchase settle. */
  onBackfillSettled?: (status: VtuBackfillTerminalStatus) => void;
  type: ValidUtilityType;
  bottomPadding: number;
}

export function UtilityPurchaseSuccessView({
  colors,
  data,
  headerOffset,
  isAuthenticated,
  onBackfillSettled,
  onCreateAccount,
  type,
  bottomPadding,
}: UtilityPurchaseSuccessViewProps) {
  const { pin: backfilledVoucherPin, status: backfilledStatus } =
    useVtuVoucherPinBackfill({
      enabled:
        (data.status === 'successful' || data.status === 'processing') &&
        !data.voucherPin,
      reference: data.reference,
      utilityType: type,
    });
  const voucherPin = data.voucherPin || backfilledVoucherPin;
  // A settled observation supersedes the submit-time status: without
  // this a telco purchase stays on "Payment Received" forever (no
  // pin ever arrives to flip it).
  const status = backfilledStatus ?? data.status;

  useEffect(() => {
    // Only on a transition (processing -> terminal): an already-
    // successful purchase already invalidated its wallet via the
    // success reference, so re-notifying would just double-refetch.
    if (
      backfilledStatus &&
      backfilledStatus !== data.status &&
      onBackfillSettled
    ) {
      onBackfillSettled(backfilledStatus);
    }
  }, [backfilledStatus, data.status, onBackfillSettled]);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingBottom: bottomPadding,
          paddingTop: headerOffset,
        },
      ]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <PurchaseSuccess
        type={type}
        amount={data.amount}
        address={data.address}
        customerIdentifier={data.customerIdentifier}
        txReference={data.reference}
        cashback={data.cashback ?? null}
        isAuthenticated={isAuthenticated}
        onCreateAccount={onCreateAccount}
        status={status}
        voucherPin={voucherPin ?? null}
      />
    </View>
  );
}
