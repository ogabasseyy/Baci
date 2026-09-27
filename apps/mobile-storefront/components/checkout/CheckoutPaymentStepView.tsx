import { useRef } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { CheckoutSavingsRetryCard } from '@/components/checkout/CheckoutSavingsRetryCard';
import {
  PaymentMethodSelector,
  type PaymentMethodSelectorProps,
} from '@/components/checkout/PaymentMethodSelector';
import { RedvaultPaymentChoice } from '@/components/checkout/redvault/RedvaultPaymentChoice';
import type Colors from '@/constants/Colors';
import { checkoutScreenViewStyles as styles } from './CheckoutScreenView.styles';

type ColorsScheme = (typeof Colors)['light'];

interface CheckoutPaymentStepViewProps {
  availablePaymentMethods: PaymentMethodSelectorProps['enabledMethods'];
  checkoutSavingsBalance: number;
  checkoutSavingsError: string | null;
  checkoutSavingsGoal: { id: string; title?: string } | null | undefined;
  colors: ColorsScheme;
  formContentPaddingBottom: number;
  hiddenPaymentMethods: PaymentMethodSelectorProps['hiddenMethods'];
  isDark: boolean;
  isLoadingCheckoutSavings: boolean;
  klumpDisabledReason: string | undefined;
  onRetrySavings: () => void;
  onSavingsToggle: NonNullable<PaymentMethodSelectorProps['onSavingsToggle']>;
  onSelectPayment: PaymentMethodSelectorProps['onSelectMethod'];
  onSelectPaymentTab: PaymentMethodSelectorProps['onSelectTab'];
  onWalletToggle: NonNullable<PaymentMethodSelectorProps['onWalletToggle']>;
  redvaultAvailable: boolean;
  paymentTab: PaymentMethodSelectorProps['selectedTab'];
  savingsSelection: PaymentMethodSelectorProps['savingsSelection'];
  selectedPayment: PaymentMethodSelectorProps['selectedMethod'];
  total: number;
  walletBalance: number;
  walletFundedBankTransferOptionEnabled: boolean;
  walletSelection: PaymentMethodSelectorProps['walletSelection'];
}

export function CheckoutPaymentStepView({
  availablePaymentMethods,
  checkoutSavingsBalance,
  checkoutSavingsError,
  checkoutSavingsGoal,
  colors,
  formContentPaddingBottom,
  hiddenPaymentMethods,
  isDark,
  isLoadingCheckoutSavings,
  klumpDisabledReason,
  onRetrySavings,
  onSavingsToggle,
  onSelectPayment,
  onSelectPaymentTab,
  onWalletToggle,
  redvaultAvailable,
  paymentTab,
  savingsSelection,
  selectedPayment,
  total,
  walletBalance,
  walletFundedBankTransferOptionEnabled,
  walletSelection,
}: CheckoutPaymentStepViewProps) {
  // Owns the payment-step ScrollView + a live scroll offset so the intent
  // accordion can scroll the just-selected card back into view when a sibling
  // card collapses. Kept in a ref (not state) to avoid re-renders on scroll.
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  };

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      style={styles.formContainer}
      contentContainerStyle={[
        styles.formContent,
        { paddingBottom: formContentPaddingBottom },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Payment Method
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
          Choose how you want to pay for this order.
        </Text>
      </View>

      {checkoutSavingsError ? (
        <CheckoutSavingsRetryCard
          colors={colors}
          isDark={isDark}
          message={checkoutSavingsError}
          onRetry={onRetrySavings}
        />
      ) : null}

      <PaymentMethodSelector
        selectedMethod={selectedPayment}
        onSelectMethod={onSelectPayment}
        selectedTab={paymentTab}
        onSelectTab={onSelectPaymentTab}
        orderTotal={total}
        enabledMethods={availablePaymentMethods}
        hiddenMethods={hiddenPaymentMethods}
        initiallyCollapsed
        walletMode="orders"
        walletBalance={walletBalance}
        walletOrderTotal={total}
        walletSelection={walletSelection}
        onWalletToggle={onWalletToggle}
        savingsBalance={isLoadingCheckoutSavings ? 0 : checkoutSavingsBalance}
        savingsGoalId={checkoutSavingsGoal?.id ?? null}
        savingsGoalTitle={checkoutSavingsGoal?.title}
        savingsSelection={savingsSelection}
        onSavingsToggle={onSavingsToggle}
        methodDisabledReasons={
          klumpDisabledReason ? { klump: klumpDisabledReason } : undefined
        }
        walletFundedBankTransferMode={
          walletFundedBankTransferOptionEnabled &&
          selectedPayment === 'bank_transfer'
        }
        methodLabelOverrides={
          walletFundedBankTransferOptionEnabled
            ? { bank_transfer: 'Bank transfer to wallet' }
            : undefined
        }
        methodDescriptionOverrides={
          walletFundedBankTransferOptionEnabled
            ? {
                bank_transfer:
                  'A permanent account number will be created for you which you can use for future purchases. We apply it to this order automatically.',
              }
            : undefined
        }
        paymentScrollRef={scrollRef}
        paymentScrollOffsetRef={scrollOffsetRef}
      />
      <RedvaultPaymentChoice
        available={redvaultAvailable}
        selected={selectedPayment === 'uba_redvault'}
        status="idle"
        onSelect={() => onSelectPayment('uba_redvault')}
      />
    </ScrollView>
  );
}
