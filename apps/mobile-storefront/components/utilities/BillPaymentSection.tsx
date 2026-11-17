import { type LayoutChangeEvent, Text, TextInput, View } from 'react-native';
import { billFormStyles as styles } from '@/components/utilities/bill-form-styles';
import type Colors from '@/constants/Colors';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { VtuWalletPayRequest } from '@/lib/wallet-pay/vtu-wallet-pay-api';
import { UtilityFormNotice } from './UtilityFormNotice';
import { UtilityPaymentOptions } from './UtilityPaymentOptions';
import { useRetainsPiggyvest } from './use-retains-piggyvest';
import type { UtilityRetainedAttempt } from './use-utility-retained-attempt';
import { sanitizeAmountInput } from './utility-amount-sanitize';

type PaymentState = ReturnType<typeof useUtilityPayment>;

interface BillPaymentSectionProps {
  /** Shown under the amount field once something is typed. */
  amountIssue?: string | null;
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
  /** The form's shared kept-attempt answer, when it has one. */
  retained?: UtilityRetainedAttempt;
  setAmount: (value: string) => void;
}

export function BillPaymentSection({
  amountIssue = null,
  colors,
  formattedAmount,
  handlePaymentLayout,
  isFixedAmount,
  numericAmount,
  payment,
  returnToHref,
  purchaseRequest = null,
  retained,
  setAmount,
}: BillPaymentSectionProps) {
  // A kept attempt replays on its own rail: store credit first, else
  // PiggyVest (the submit decides the same way).
  // The form's shared lookup when given (the Pay gate reads the same one).
  const ownPiggyvest = useRetainsPiggyvest(retained ? null : purchaseRequest);
  const retainedStoreCredit = retained
    ? retained.retainedStoreCredit
    : purchaseRequest !== null &&
      payment.hasRetainedVtuAttempt?.({ ...purchaseRequest }) === true;
  const retainedPiggyvest = retained
    ? retained.retainedPiggyvest
    : ownPiggyvest;
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
        {amountIssue && formattedAmount ? (
          <UtilityFormNotice compact message={amountIssue} />
        ) : null}
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
