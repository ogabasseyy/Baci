import { useEffect } from 'react';
import { View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { palette } from '@/constants/Colors';
import { formatPrice } from '@/stores/cart-store';
import { InstrumentRows } from './payment-method-selector/InstrumentRows';
import { PaymentIntentAccordion } from './payment-method-selector/PaymentIntentAccordion';
import { PaymentMethodStatusPanels } from './payment-method-selector/PaymentMethodStatusPanels';
import { PaymentMethodStoreCreditRows } from './payment-method-selector/PaymentMethodStoreCreditRows';
import type { PaymentIntent } from './payment-method-selector/payment-intents';
import { paymentMethodSelectorStyles as styles } from './payment-method-selector/styles';
import {
  DEFAULT_SAVINGS_FALLBACK_TITLE,
  type PaymentMethodSelectorProps,
} from './payment-method-selector/types';
import { usePaymentMethodAvailability } from './payment-method-selector/usePaymentMethodAvailability';

export type {
  PaymentMethod,
  PaymentMethodSelectorProps,
  PaymentMethodType,
  PaymentTab,
  SavingsSelection,
  WalletMode,
  WalletSelection,
} from './payment-method-selector/types';

export function PaymentMethodSelector({
  selectedMethod,
  onSelectMethod,
  selectedTab,
  onSelectTab,
  orderTotal,
  showInstallmentCalculator = true,
  enabledMethods,
  walletMode = 'off',
  walletBalance = 0,
  walletError = null,
  walletIsLoading = false,
  walletOrderTotal,
  walletSelection,
  onWalletToggle,
  savingsBalance = 0,
  savingsFallbackTitle = DEFAULT_SAVINGS_FALLBACK_TITLE,
  savingsGoalId,
  savingsGoalTitle,
  savingsSelection,
  onSavingsToggle,
  suppressedSelectedMethods = [],
  hiddenMethods = [],
  methodBadgeOverrides = {},
  methodDescriptionOverrides = {},
  methodDisabledReasons = {},
  methodLabelOverrides = {},
  walletFundedBankTransferMode = false,
  walletIsStoreCredit = false,
  paymentScrollRef,
  paymentScrollOffsetRef,
  initiallyCollapsed = false,
}: PaymentMethodSelectorProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = (colorScheme ?? 'light') === 'dark';
  const warningBackground = isDark
    ? 'rgba(245, 158, 11, 0.12)'
    : palette.amber[100];
  const warningTextColor = isDark ? colors.text : palette.amber[800];
  const warningSubtleTextColor = isDark
    ? colors.textSecondary
    : palette.amber[800];

  const {
    availableMethodIds,
    filteredMethods,
    hasBNPLMethods,
    hasPayLaterMethods,
    hasValidTotal,
    isBNPLEligible,
    supportsPartialPayment,
  } = usePaymentMethodAvailability({
    enabledMethods,
    hiddenMethods,
    methodDisabledReasons,
    orderTotal,
    selectedMethod,
    selectedTab,
    walletSelection,
    savingsSelection,
  });

  useEffect(() => {
    if (
      selectedTab === 'installments' &&
      (!hasBNPLMethods || !isBNPLEligible)
    ) {
      onSelectTab('full');
      return;
    }
    if (selectedTab === 'pay_later' && !hasPayLaterMethods) {
      onSelectTab('full');
    }
  }, [
    selectedTab,
    hasBNPLMethods,
    hasPayLaterMethods,
    isBNPLEligible,
    onSelectTab,
  ]);

  const savingsShouldRender =
    Boolean(savingsGoalId) &&
    savingsBalance > 0 &&
    orderTotal > 0 &&
    selectedTab === 'full' &&
    supportsPartialPayment;
  const savingsCoversFully =
    savingsShouldRender && savingsBalance >= orderTotal;
  const savingsPortion = savingsShouldRender
    ? Math.min(savingsBalance, orderTotal)
    : 0;
  const savingsResidualToGateway = savingsShouldRender
    ? Math.max(orderTotal - savingsBalance, 0)
    : 0;
  const savingsIsActive =
    savingsSelection?.use === true &&
    Boolean(savingsGoalId) &&
    savingsSelection.goalId === savingsGoalId;
  const activeSavingsAmount = savingsIsActive ? savingsPortion : 0;
  const savingsGoalDisplayName = savingsGoalTitle ?? savingsFallbackTitle;
  const savingsAccessibilityLabel = savingsCoversFully
    ? `Pay with device savings, ${formatPrice(savingsBalance)} available`
    : `Use device savings, ${formatPrice(savingsPortion)} of ${formatPrice(orderTotal)}`;

  const walletEffectiveTotal = Math.max(
    (walletOrderTotal ?? orderTotal) - activeSavingsAmount,
    0
  );
  const walletAttemptAllowed =
    (walletMode === 'orders' || walletMode === 'vtu') &&
    walletEffectiveTotal > 0 &&
    supportsPartialPayment;
  const walletCoversTotal = walletBalance >= walletEffectiveTotal;
  const walletFundedBankTransferActive =
    walletFundedBankTransferMode &&
    selectedMethod === 'bank_transfer' &&
    selectedTab === 'full';
  const walletShouldRender =
    walletAttemptAllowed &&
    (!walletFundedBankTransferActive || walletCoversTotal) &&
    walletBalance > 0 &&
    !walletIsLoading &&
    walletError === null;
  const walletInfoShouldRender =
    walletAttemptAllowed &&
    walletFundedBankTransferActive &&
    walletBalance > 0 &&
    !walletCoversTotal &&
    !walletIsLoading &&
    walletError === null;
  const walletStatusShouldRender =
    walletAttemptAllowed &&
    !walletShouldRender &&
    (walletIsLoading || walletError !== null);
  const walletCoversFully = walletShouldRender && walletCoversTotal;
  const walletPortion =
    walletShouldRender || walletInfoShouldRender
      ? Math.min(walletBalance, walletEffectiveTotal)
      : 0;
  const walletResidualToCard = walletShouldRender
    ? Math.max(walletEffectiveTotal - walletBalance, 0)
    : 0;
  const walletIsActive = walletSelection?.use === true;

  // Selecting an intent projects onto the existing (tab, method) state. For the
  // two terminal `pay_later` intents we also pin the specific method, because
  // onSelectTab auto-selects the first method of the tab (invoice).
  const handleSelectIntent = (intent: PaymentIntent) => {
    onSelectTab(intent.tab);
    if (intent.method) onSelectMethod(intent.method);
  };

  const savingsSuppressesGateway = savingsCoversFully && savingsIsActive;
  const walletSuppressesGateway = walletCoversFully && walletIsActive;
  const showInstruments =
    selectedTab === 'full' || selectedTab === 'installments';
  const instrumentRows = showInstruments ? (
    <InstrumentRows
      colors={colors}
      methodBadgeOverrides={methodBadgeOverrides}
      methodDescriptionOverrides={methodDescriptionOverrides}
      methodLabelOverrides={methodLabelOverrides}
      methods={filteredMethods}
      onSelectMethod={onSelectMethod}
      savingsSuppressesGateway={savingsSuppressesGateway}
      selectedMethod={selectedMethod}
      suppressedSelectedMethods={suppressedSelectedMethods}
      walletSuppressesGateway={walletSuppressesGateway}
    />
  ) : null;

  const showCreditSection =
    walletShouldRender ||
    walletInfoShouldRender ||
    walletStatusShouldRender ||
    savingsShouldRender;

  return (
    <View style={styles.container}>
      <PaymentIntentAccordion
        availableMethodIds={availableMethodIds}
        colors={colors}
        hasBNPLMethods={hasBNPLMethods}
        hasPayLaterMethods={hasPayLaterMethods}
        initiallyCollapsed={initiallyCollapsed}
        isBNPLEligible={isBNPLEligible}
        nestedRows={instrumentRows}
        onSelectIntent={handleSelectIntent}
        orderTotal={orderTotal}
        scrollOffsetRef={paymentScrollOffsetRef}
        scrollRef={paymentScrollRef}
        selectedInfo={
          selectedMethod && selectedTab ? (
            <>
              <PaymentMethodStatusPanels
                colors={colors}
                hasValidTotal={hasValidTotal}
                isBNPLEligible={isBNPLEligible}
                orderTotal={orderTotal}
                selectedMethod={selectedMethod}
                selectedTab={selectedTab}
                showInstallmentCalculator={showInstallmentCalculator}
                warningBackground={warningBackground}
                warningSubtleTextColor={warningSubtleTextColor}
                warningTextColor={warningTextColor}
                walletFundedBankTransferMode={walletFundedBankTransferMode}
              />
              {showCreditSection ? (
                <PaymentMethodStoreCreditRows
                  colors={colors}
                  onSavingsToggle={
                    onSavingsToggle
                      ? () =>
                          onSavingsToggle(
                            savingsIsActive
                              ? { use: false, goalId: null, amount: 0 }
                              : {
                                  use: true,
                                  goalId: savingsGoalId ?? null,
                                  amount: savingsPortion,
                                }
                          )
                      : undefined
                  }
                  onWalletToggle={
                    onWalletToggle
                      ? () =>
                          onWalletToggle(
                            walletIsActive
                              ? { use: false, amount: 0 }
                              : { use: true, amount: walletPortion }
                          )
                      : undefined
                  }
                  savingsAccessibilityLabel={savingsAccessibilityLabel}
                  savingsCoversFully={savingsCoversFully}
                  savingsGoalDisplayName={savingsGoalDisplayName}
                  savingsIsActive={savingsIsActive}
                  savingsPortion={savingsPortion}
                  savingsResidualToGateway={savingsResidualToGateway}
                  savingsShouldRender={savingsShouldRender}
                  savingsTotalBalance={savingsBalance}
                  walletEffectiveTotal={walletEffectiveTotal}
                  walletCoversFully={walletCoversFully}
                  walletInfoShouldRender={walletInfoShouldRender}
                  walletIsStoreCredit={walletIsStoreCredit}
                  walletIsActive={walletIsActive}
                  walletIsLoading={walletIsLoading}
                  walletPortion={walletPortion}
                  walletResidualToCard={walletResidualToCard}
                  walletShouldRender={walletShouldRender}
                  walletStatusShouldRender={walletStatusShouldRender}
                  walletTotalBalance={walletBalance}
                />
              ) : null}
            </>
          ) : null
        }
        selectedMethod={selectedMethod}
        selectedTab={selectedTab}
      />
    </View>
  );
}
