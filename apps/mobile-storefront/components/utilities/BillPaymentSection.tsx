import { type LayoutChangeEvent, Text, TextInput, View } from 'react-native';
import { billFormStyles as styles } from '@/components/utilities/bill-form-styles';
import type Colors from '@/constants/Colors';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { VtuWalletPayRequest } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { UtilityPaymentOptions } from './UtilityPaymentOptions';
import { useRetainsPiggyvest } from './use-retains-piggyvest';
import { sanitizeAmountInput } from './utility-amount-sanitize';

type PaymentState = ReturnType<typeof useUtilityPayment>;

interface BillPaymentSectionProps {
  colors: typeof Colors.light;
  formattedAmount: string;
  handlePaymentLayout: (event: LayoutChangeEvent) => void;
  isFixedAmount: boolean;
  numericAmount: number;
  payment: PaymentState;
  /** Prefilled bill deep-link the wallet returns to after a bank transfer. */
  returnToHref: WalletReturnHref;
  /** The exact request the submit builds (its retry identity), or null. */
  purchaseRequest?: VtuWalletPayRequest | null;
  setAmount: (value: string) => void;
}

export function BillPaymentSection({
  colors,
  formattedAmount,
  handlePaymentLayout,
  isFixedAmount,
  numericAmount,
  payment,
  returnToHref,
  purchaseRequest = null,
  setAmount,
}: BillPaymentSectionProps) {
  // A kept attempt replays on its own rail: store credit first, else
  // PiggyVest (the submit decides the same way).
  const retainedStoreCredit =
    purchaseRequest !== null &&
    payment.hasRetainedVtuAttempt?.({ ...purchaseRequest }) === true;
  const retainedPiggyvest = useRetainsPiggyvest(purchaseRequest);
  return (
    <View onLayout={handlePaymentLayout}>
      <View style={styles.amountSection}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Amount (₦)
        </Text>
        <TextInput
          style={[
            styles.input,
            isFixedAmount && styles.inputDisabled,
            {
              backgroundColor: colors.muted,
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          placeholder={
            isFixedAmount ? 'Amount set by provider' : 'Enter amount'
          }
          placeholderTextColor={colors.placeholder}
          keyboardType="decimal-pad"
          value={formattedAmount}
          editable={!isFixedAmount}
          accessibilityLabel={
            isFixedAmount ? 'Payment amount read-only' : 'Payment amount'
          }
          maxLength={10}
          onChangeText={(text) => setAmount(sanitizeAmountInput(text))}
        />
      </View>

      <UtilityPaymentOptions
        amount={numericAmount}
        canFundByBankTransfer={payment.canFundByBankTransfer}
        returnToHref={returnToHref}
        walletBalance={payment.getWalletBalance()}
        walletError={payment.walletError}
        walletIsLoading={payment.walletIsLoading}
        walletIsSettled={payment.isWalletSettled()}
        walletIsStoreCredit={payment.walletIsStoreCredit}
        walletPrimaryUnknown={payment.walletPrimaryUnknown}
        retainedStoreCredit={retainedStoreCredit}
        retainedPiggyvest={retainedPiggyvest}
      />
    </View>
  );
}
