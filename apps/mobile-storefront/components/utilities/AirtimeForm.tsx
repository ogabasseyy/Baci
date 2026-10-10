import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, SPACING } from '@/constants/Colors';
import { airtimeFormStyles as styles } from './airtime-form.styles';
import type { AirtimeFormProps } from './airtime-form.types';
import { ProviderGrid } from './ProviderGrid';
import { RecentUtilityRecipients } from './RecentUtilityRecipients';
import { UtilityPaymentOptions } from './UtilityPaymentOptions';
import { useAirtimeFormController } from './use-airtime-form-controller';

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export function AirtimeForm(props: AirtimeFormProps) {
  const { onSelectRecentRecipient, recentRecipients = [] } = props;
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  // Destructure the controller result: keeping the whole object makes the
  // compiler treat every property read as a ref access (it bundles scrollViewRef).
  const {
    footerBottomOffset,
    footerSpacerHeight,
    formattedAmount,
    handlePaymentLayout,
    handlePhoneChange,
    handleProviderSelect,
    handlePurchase,
    insets,
    isBeneficiarySelected,
    isKeyboardVisible,
    isNetworkPickerExpanded,
    isSubmitting,
    numericAmount,
    payment,
    phoneNumber,
    scrollViewRef,
    selectedProvider,
    selectedProviderConfig,
    setAmount,
    setIsBeneficiarySelected,
    setIsNetworkPickerExpanded,
    walletReturnToHref,
  } = useAirtimeFormController(props);

  const matchingRecipients = recentRecipients.filter((recipient) => {
    if (!phoneNumber) return true;
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const cleanRecip = (recipient.identifier ?? '').replace(/\D/g, '');
    return (
      cleanRecip.includes(cleanPhone) ||
      recipient.title.toLowerCase().includes(phoneNumber.toLowerCase())
    );
  });

  const handleSelectRecentRecipient = (
    recipient: (typeof recentRecipients)[0]
  ) => {
    handlePhoneChange(recipient.defaults.phoneNumber ?? '');
    setIsBeneficiarySelected(true);
    if (onSelectRecentRecipient) {
      onSelectRecentRecipient(recipient);
    }
  };

  const shouldShowBeneficiaryList =
    !isBeneficiarySelected &&
    (phoneNumber.length < 5 || matchingRecipients.length > 0);

  const canShowBeneficiaries =
    recentRecipients.length > 0 &&
    Boolean(onSelectRecentRecipient) &&
    shouldShowBeneficiaryList;

  const shouldShowNetworkSection =
    isBeneficiarySelected ||
    (phoneNumber.length >= 5 && matchingRecipients.length === 0);

  const shouldShowSelectedNetwork =
    Boolean(selectedProvider) && !isNetworkPickerExpanded;

  const shouldShowManualNetworkPicker =
    isNetworkPickerExpanded || (phoneNumber.length >= 4 && !selectedProvider);

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
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Phone Number
        </Text>

        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.muted,
              color: colors.text,
              borderColor: colors.border,
              marginBottom: 16,
            },
          ]}
          placeholder="08012345678"
          placeholderTextColor={colors.placeholder}
          keyboardType="phone-pad"
          value={phoneNumber}
          onChangeText={handlePhoneChange}
        />

        {canShowBeneficiaries ? (
          <RecentUtilityRecipients
            colors={colors}
            recipients={matchingRecipients}
            onSelect={handleSelectRecentRecipient}
          />
        ) : null}

        {shouldShowNetworkSection && shouldShowSelectedNetwork ? (
          <View
            style={[
              styles.selectedNetworkCard,
              {
                backgroundColor: `${BRAND.primary}10`,
                borderColor: BRAND.primary,
              },
            ]}
          >
            {selectedProviderConfig ? (
              <Image
                source={selectedProviderConfig.image}
                style={styles.selectedNetworkLogo}
                resizeMode="contain"
                accessibilityLabel={`${selectedProviderConfig.name} logo`}
              />
            ) : null}
            <View style={styles.selectedNetworkCopy}>
              <Text
                style={[
                  styles.selectedNetworkLabel,
                  { color: colors.textSecondary },
                ]}
              >
                Network
              </Text>
              <Text
                style={[styles.selectedNetworkName, { color: colors.text }]}
              >
                {selectedProviderConfig?.name ?? selectedProvider}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change selected network"
              onPress={() => setIsNetworkPickerExpanded(true)}
              style={[styles.changeButton, { borderColor: BRAND.primary }]}
            >
              <Text style={styles.changeButtonText}>Change</Text>
            </Pressable>
          </View>
        ) : null}

        {shouldShowNetworkSection && shouldShowManualNetworkPicker ? (
          <View style={styles.networkPicker}>
            <ProviderGrid
              selectedProvider={selectedProvider}
              onSelect={handleProviderSelect}
            />
          </View>
        ) : null}

        <View style={styles.inputGroup}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Amount (₦)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.muted,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder="1,000"
            placeholderTextColor={colors.placeholder}
            keyboardType="number-pad"
            value={formattedAmount}
            onChangeText={(text) => setAmount(text.replace(/\D/g, ''))}
          />
          <View style={styles.quickAmounts}>
            {QUICK_AMOUNTS.map((amount) => {
              const isSelectedAmount = numericAmount === amount;

              return (
                <Pressable
                  key={amount}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelectedAmount }}
                  style={[
                    styles.quickChip,
                    {
                      backgroundColor: isSelectedAmount
                        ? BRAND.primary
                        : colors.background,
                      borderColor: isSelectedAmount
                        ? BRAND.primary
                        : colors.border,
                    },
                  ]}
                  onPress={() => setAmount(String(amount))}
                >
                  <Text
                    style={[
                      styles.quickChipText,
                      {
                        color: isSelectedAmount ? BRAND.onPrimary : colors.text,
                      },
                    ]}
                  >
                    ₦{amount.toLocaleString()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View onLayout={handlePaymentLayout}>
          <UtilityPaymentOptions
            amount={numericAmount}
            canFundByBankTransfer={payment.canFundByBankTransfer}
            returnToHref={walletReturnToHref}
            walletBalance={payment.walletBalance}
            walletError={payment.walletError}
            walletIsLoading={payment.walletIsLoading}
          />
        </View>
      </ScrollView>

      {isKeyboardVisible ? null : (
        <View
          style={[
            styles.footer,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.muted,
              bottom: footerBottomOffset,
              paddingBottom: Math.max(insets.bottom, SPACING.md),
            },
          ]}
        >
          <Pressable
            style={[
              styles.payButton,
              {
                backgroundColor: BRAND.primary,
                opacity: isSubmitting ? 0.7 : 1,
              },
            ]}
            onPress={handlePurchase}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={BRAND.onPrimary} />
            ) : (
              <Text style={styles.payButtonText}>
                {`Pay ₦${numericAmount ? numericAmount.toLocaleString() : '0'}`}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </>
  );
}
