import { ScrollView, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { BillerList } from './BillerList';
import { BillItemSelectionSection } from './BillItemSelectionSection';
import { BillPaymentFooter } from './BillPaymentFooter';
import { BillPaymentSection } from './BillPaymentSection';
import type { BillFormProps } from './bill-form.types';
import { billFormStyles as styles } from './bill-form-styles';
import { RecentUtilityRecipients } from './RecentUtilityRecipients';
import { useBillFormController } from './use-bill-form-controller';

export function BillForm(props: BillFormProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const {
    beneficiaries,
    billersQuery,
    billItemSelection,
    canShowPayment,
    customerId,
    footerBottomOffset,
    footerSpacerHeight,
    formattedAmount,
    handleBillItemSelect,
    handleBillerSelect,
    handlePaymentLayout,
    handlePurchase,
    handleSelectBeneficiary,
    handleVerify,
    insets,
    isBillItemSelectionComplete,
    isBusy,
    isFixedAmount,
    isKeyboardVisible,
    isProviderPickerExpanded,
    isRepeatPaymentActive,
    numericAmount,
    payment,
    scheduleNextStepScroll,
    scrollViewRef,
    selectedBiller,
    selectedBillItemIdentifier,
    setProviderPickerExpanded,
    setRepeatPaymentActive,
    shouldScrollToNextStep,
    updateAmount,
    updateCustomerId,
    verifiedCustomerName,
    verify,
    walletReturnToHref,
  } = useBillFormController(props);

  // Returning users repeat far more than they add new meters, so when there are
  // beneficiaries the full provider grid collapses behind an "Other providers"
  // row. First-timers (no beneficiaries) still get the grid expanded by default.
  const hasBeneficiaries = (props.recentRecipients?.length ?? 0) > 0;

  // Show providers in a predictable A–Z order regardless of API ordering.
  const sortedBillers = [...(billersQuery.data ?? [])].sort((a, b) =>
    a.billerName.localeCompare(b.billerName, undefined, { sensitivity: 'base' })
  );

  return (
    <>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: footerSpacerHeight },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {!selectedBiller &&
        hasBeneficiaries &&
        props.onSelectRecentRecipient ? (
          <RecentUtilityRecipients
            colors={colors}
            recipients={props.recentRecipients ?? []}
            onSelect={props.onSelectRecentRecipient}
            label="Pay again"
          />
        ) : null}

        <BillerList
          billers={sortedBillers}
          selectedBillerId={selectedBiller?.billerId ?? null}
          onSelect={handleBillerSelect}
          isLoading={billersQuery.isLoading}
          isCollapsed={
            (!!selectedBiller || hasBeneficiaries) && !isProviderPickerExpanded
          }
          onChangeSelection={() => {
            setRepeatPaymentActive(false);
            setProviderPickerExpanded(true);
          }}
          errorMessage={
            billersQuery.isError
              ? billersQuery.error instanceof Error
                ? billersQuery.error.message
                : 'Failed to load providers. Please try again.'
              : undefined
          }
        />

        {selectedBiller ? (
          <View
            onLayout={(event) => {
              if (shouldScrollToNextStep) {
                scheduleNextStepScroll(event.nativeEvent.layout.y);
              }
            }}
          >
            <BillItemSelectionSection
              beneficiaries={beneficiaries}
              billItemSelection={billItemSelection}
              colors={colors}
              customerId={customerId}
              handleBillItemSelect={handleBillItemSelect}
              handleSelectBeneficiary={handleSelectBeneficiary}
              handleVerify={handleVerify}
              isBillItemSelectionComplete={isBillItemSelectionComplete}
              isRepeatPaymentActive={isRepeatPaymentActive}
              recentRecipients={props.recentRecipients}
              onSelectRecentRecipient={props.onSelectRecentRecipient}
              verifiedCustomerName={verifiedCustomerName}
              selectedBillItemIdentifier={selectedBillItemIdentifier}
              selectedBillerId={selectedBiller.billerId}
              setCustomerId={updateCustomerId}
              setIsRepeatPaymentActive={setRepeatPaymentActive}
              type={props.type}
              verify={verify}
            />
          </View>
        ) : null}

        {canShowPayment ? (
          <BillPaymentSection
            colors={colors}
            formattedAmount={formattedAmount}
            handlePaymentLayout={handlePaymentLayout}
            isFixedAmount={isFixedAmount}
            numericAmount={numericAmount}
            payment={payment}
            returnToHref={walletReturnToHref}
            setAmount={updateAmount}
          />
        ) : null}
      </ScrollView>

      {canShowPayment ? (
        <BillPaymentFooter
          colors={colors}
          footerBottomOffset={footerBottomOffset}
          insetsBottom={insets.bottom}
          isBusy={isBusy}
          isKeyboardVisible={isKeyboardVisible}
          numericAmount={numericAmount}
          onPurchase={handlePurchase}
        />
      ) : null}
    </>
  );
}
