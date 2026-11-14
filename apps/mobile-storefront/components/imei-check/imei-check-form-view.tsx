import type {
  ImeiBrandFilter,
  ImeiDeviceCategory,
  ImeiIdentifierType,
  ImeiServiceTierDefinition,
  ImeiServiceTierKey,
} from '@baci/shared/imei';
import { isValidDeviceIdentifier } from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND, SPACING } from '@/constants/Colors';
import { useKeyboard } from '@/hooks/use-keyboard';
import { formatServicePrice } from './format-service-price';
import { ImeiBrandChips } from './ImeiBrandChips';
import { styles } from './imei-check.styles';
import type { ImeiCheckerColors } from './imei-check.types';
import { ImeiCheckInputSection } from './imei-check-input-section';
import { ImeiCheckServiceSelector } from './imei-check-service-selector';
import { ImeiWalletBadge } from './imei-wallet-badge';
import { getImeiWalletCopy } from './imei-wallet-copy';

interface ImeiCheckFormViewProps {
  colors: ImeiCheckerColors;
  currentTier: ImeiServiceTierDefinition;
  displayedTierKeys: readonly ImeiServiceTierKey[];
  error: string | null;
  identifier: ImeiIdentifierType;
  imei: string;
  isLoading: boolean;
  isWalletError: boolean;
  isWalletLoading: boolean;
  selectedBrand: ImeiBrandFilter;
  selectedDevice: ImeiDeviceCategory;
  selectedTier: ImeiServiceTierKey | null;
  availabilityFailed?: boolean;
  availabilityLoading?: boolean;
  onRetryAvailability?: () => void;
  canToggleServices: boolean;
  showAllServices: boolean;
  walletBalance: number;
  /** PiggyVest customer: the balance is store credit. */
  walletIsStoreCredit?: boolean;
  /** True when the PiggyVest wallet pays this check (store credit can't). */
  /** Paying from the PiggyVest wallet (dark until switched on). */
  walletPay?: ImeiWalletPayView;
  onBrandSelect: (brand: ImeiBrandFilter) => void;
  onChangeImei: (value: string) => void;
  onCheck: () => void;
  onClearImei: () => void;
  onTierSelect: (tier: ImeiServiceTierKey) => void;
  onTopUpWallet: (amount: number) => void;
  onToggleServices: () => void;
}

export type ImeiWalletPayView = {
  covers: (tier: ImeiServiceTierKey) => boolean;
  /** The PiggyVest balance that may pay, or null (off, stale, none). */
  savingsKobo: number | null;
};
export function ImeiCheckFormView({
  availabilityFailed = false,
  availabilityLoading = false,
  onRetryAvailability,
  colors,
  currentTier,
  displayedTierKeys,
  error,
  identifier,
  imei,
  isLoading,
  isWalletError,
  isWalletLoading,
  selectedBrand,
  selectedDevice,
  selectedTier,
  canToggleServices,
  showAllServices,
  walletBalance,
  walletIsStoreCredit = false,
  walletPay,
  onBrandSelect,
  onChangeImei,
  onCheck,
  onClearImei,
  onTierSelect,
  onTopUpWallet,
  onToggleServices,
}: ImeiCheckFormViewProps) {
  const insets = useSafeAreaInsets();
  // The home-indicator inset is buried under the keyboard while it's open —
  // keeping it floats the footer a full inset above the keyboard for nothing.
  const { isKeyboardVisible } = useKeyboard();
  const walletCopy = getImeiWalletCopy(walletIsStoreCredit);
  const isWalletReady = !(isWalletLoading || isWalletError);
  const paysFromPiggyvest =
    selectedTier !== null &&
    isWalletReady &&
    walletBalance < currentTier.price &&
    walletPay?.covers(selectedTier) === true;
  // With paying from PiggyVest on, the badge shows the savings wallet while
  // it is what pays (or before a check is chosen), never a store credit ₦0
  // that reads as empty; otherwise the store credit the check spends.
  const savingsKobo =
    selectedTier === null || paysFromPiggyvest
      ? (walletPay?.savingsKobo ?? null)
      : null;
  const hasEnoughBalance =
    isWalletReady && (walletBalance >= currentTier.price || paysFromPiggyvest);
  const needsTopUp =
    selectedTier !== null && isWalletReady && !hasEnoughBalance;
  const shortfall = Math.max(0, currentTier.price - walletBalance);
  const findHint =
    identifier === 'serial'
      ? 'Find it in Settings › General › About'
      : identifier === 'both'
        ? 'Dial *#06# or Settings › General › About'
        : 'Dial *#06# to find your IMEI';
  const canVerify =
    selectedTier !== null &&
    displayedTierKeys.includes(selectedTier) &&
    isValidDeviceIdentifier(imei, identifier) &&
    hasEnoughBalance;
  const walletStatusText = isWalletLoading
    ? walletCopy.loading
    : isWalletError
      ? walletCopy.unavailable
      : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.keyboardView}>
        {selectedDevice === 'smartphone' ? (
          <ImeiBrandChips
            colors={colors}
            selectedBrand={selectedBrand}
            onBrandSelect={onBrandSelect}
          />
        ) : null}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {displayedTierKeys.length === 0 || availabilityFailed ? (
            <View accessibilityLiveRegion="polite">
              <Text style={{ color: colors.text }}>
                {displayedTierKeys.length === 0
                  ? availabilityLoading
                    ? 'Checking available services…'
                    : 'No checks are available for this selection.'
                  : 'Some services could not be checked.'}
              </Text>
              {!availabilityLoading && onRetryAvailability ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry available checks"
                  onPress={onRetryAvailability}
                  style={styles.retryButton}
                >
                  <Ionicons name="refresh" size={16} color={BRAND.primary} />
                  <Text style={styles.retryButtonText}>
                    Retry available checks
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <ImeiCheckServiceSelector
            colors={colors}
            displayedTierKeys={displayedTierKeys}
            selectedTier={selectedTier}
            canToggleServices={canToggleServices}
            showAllServices={showAllServices}
            onTierSelect={onTierSelect}
            onToggleServices={onToggleServices}
          />
          {walletStatusText ? (
            <View
              style={[
                styles.errorContainer,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="wallet-outline"
                size={18}
                color={colors.textSecondary}
              />
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>
                {walletStatusText}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View
          testID="imei-check-footer"
          style={[
            styles.bottomAction,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: isKeyboardVisible
                ? SPACING.sm
                : Math.max(insets.bottom, SPACING.sm),
            },
          ]}
        >
          <ImeiCheckInputSection
            colors={colors}
            error={error}
            identifier={identifier}
            imei={imei}
            onChangeImei={onChangeImei}
            onCheck={onCheck}
            onClearImei={onClearImei}
          />
          {needsTopUp ? null : (
            <Text style={[styles.footerHint, { color: colors.textSecondary }]}>
              {findHint}
            </Text>
          )}
          <View style={styles.footerRow}>
            <ImeiWalletBadge
              colors={colors}
              isWalletReady={isWalletReady}
              needsTopUp={needsTopUp}
              savingsKobo={savingsKobo}
              statusText={walletStatusText}
              walletBalance={walletBalance}
              walletCopy={walletCopy}
            />
            <Pressable
              style={[
                styles.verifyButton,
                { backgroundColor: BRAND.primary },
                (isLoading || (!needsTopUp && !canVerify)) &&
                  styles.verifyButtonDisabled,
              ]}
              onPress={needsTopUp ? () => onTopUpWallet(shortfall) : onCheck}
              disabled={isLoading || (!needsTopUp && !canVerify)}
            >
              {isLoading ? (
                <ActivityIndicator color={BRAND.onPrimary} />
              ) : (
                <>
                  <Text style={styles.verifyButtonText}>
                    {selectedTier === null
                      ? 'Choose a check'
                      : isWalletLoading
                        ? walletCopy.loadingButton
                        : isWalletError
                          ? walletCopy.unavailableButton
                          : needsTopUp
                            ? walletCopy.topUpButton
                            : paysFromPiggyvest
                              ? // The check it pays for is named: the
                                // preselected card can sit below the fold
                                // (Fable walk 15); the savings badge beside
                                // it shows where the money comes from.
                                `Pay ${formatServicePrice(currentTier.price)} for ${currentTier.name}`
                              : `Verify Now - ${formatServicePrice(currentTier.price)}`}
                  </Text>
                  <Ionicons name="sparkles" size={18} color={BRAND.onPrimary} />
                </>
              )}
            </Pressable>
          </View>
          {needsTopUp ? (
            <Text style={[styles.footerHint, { color: colors.error }]}>
              {walletCopy.shortfallHint(shortfall)}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
