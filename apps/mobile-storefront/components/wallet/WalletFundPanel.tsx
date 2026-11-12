import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type Colors from '@/constants/Colors';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { useWalletFundPanelAutoCreate } from './use-wallet-fund-panel-auto-create';
import { WalletCardTopUpForm } from './WalletCardTopUpForm';
import { WalletCreditCheckPanel } from './WalletCreditCheckPanel';
import {
  WalletFundPhonePrompt,
  type WalletFundPhoneSubmitResult,
} from './WalletFundPhonePrompt';
import { WalletProviderAttribution } from './WalletProviderAttribution';
import type { WalletDisplayFundingAccount } from './wallet.types';
import { styles } from './wallet-fund-panel.styles';

type WalletColors = (typeof Colors)['light'];

const BANK_TRANSFER_TITLE = 'Add Money';
const BANK_TRANSFER_SUBTITLE =
  'Transfer to your account number below and your wallet is credited automatically — 1% fee, capped at ₦300.';
const SETTING_UP_ACCOUNT = 'Setting up your account number...';
const SETUP_FAILED =
  "We couldn't set up your account number just now. Fund with card below, or try bank transfer again later.";
const CARD_TOGGLE_LABEL = 'Fund with card instead';
const STORE_CREDIT_TITLE = 'Add store credit';
const STORE_CREDIT_SUBTITLE =
  "Your savings wallet can't pay for this yet. Pay by card to add store credit, then finish your purchase.";
const STORE_CREDIT_CARD_SUBTITLE =
  'Adds store credit for this purchase. Card top-ups have a minimum; anything extra stays as store credit.';

interface WalletFundPanelProps {
  canCreateFundingAccount: boolean;
  colors: WalletColors;
  createFundingAccountUnavailableMessage?: string;
  creditWatch: WalletCreditWatch;
  fundAmount: string;
  fundingAccount: WalletDisplayFundingAccount | null;
  /** A card top-up credits the legacy wallet: hidden for primary-funded flows. */
  hideCardFunding?: boolean;
  isCreatingFundingAccount: boolean;
  isFundPending: boolean;
  needsPhone: boolean;
  onChangeFundAmount: (value: string) => void;
  onConfirmFund: () => void;
  // Returns a boolean success flag when awaited (false = creation failed);
  // typed as unknown so a plain `() => void` handler is still accepted.
  onCreateFundingAccount: () => unknown;
  onResetFund: () => void;
  onSubmitPhone: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
  returnToSavings?: boolean;
  /**
   * PiggyVest customer topping up for a purchase (e.g. an IMEI check):
   * purchases spend store credit, which only a card top-up adds. The
   * PiggyVest account number is hidden because transfers to it land in
   * the savings wallet, not store credit.
   */
  storeCreditTopUp?: boolean;
}

export function WalletFundPanel({
  canCreateFundingAccount,
  colors,
  createFundingAccountUnavailableMessage,
  creditWatch,
  fundAmount,
  fundingAccount,
  hideCardFunding = false,
  isCreatingFundingAccount,
  isFundPending,
  needsPhone,
  onChangeFundAmount,
  onConfirmFund,
  onCreateFundingAccount,
  onResetFund,
  onSubmitPhone,
  returnToSavings = false,
  storeCreditTopUp = false,
}: WalletFundPanelProps) {
  const insets = useSafeAreaInsets();
  // Tracks the "Fund with card instead" toggle. Card entry is ALSO shown
  // whenever a prefilled amount is present (see cardEntryVisible), which
  // covers a route change that prefills the amount while the panel is open.
  const [showCardEntry, setShowCardEntry] = useState(false);
  const { copyToClipboard, feedback: copyFeedback } = useCopyToClipboard();
  const { autoCreateFailed, openedWithPrefill } = useWalletFundPanelAutoCreate({
    canCreateFundingAccount: canCreateFundingAccount && !storeCreditTopUp,
    fundAmount,
    hasFundingAccount: Boolean(fundingAccount),
    isCreatingFundingAccount,
    onCreateFundingAccount,
  });

  // `needsPhone` is excluded so the card entry does NOT auto-expand while the
  // phone prompt is showing — card stays behind the "Fund with card" toggle.
  const bankTransferUnavailable =
    !fundingAccount &&
    !canCreateFundingAccount &&
    !isCreatingFundingAccount &&
    !needsPhone;
  // Reactive to fundAmount so a prefilled amount always reveals card entry,
  // even if it arrives after the panel is already mounted; openedWithPrefill
  // keeps it visible if the customer clears the prefilled input.
  const cardEntryVisible =
    storeCreditTopUp ||
    showCardEntry ||
    openedWithPrefill ||
    fundAmount !== '' ||
    bankTransferUnavailable ||
    autoCreateFailed;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={[
        styles.sheet,
        {
          backgroundColor: colors.card,
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      <View style={[styles.handle, { backgroundColor: colors.border }]} />
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
            YOUR WALLET
          </Text>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: colors.text }]}
          >
            {storeCreditTopUp ? STORE_CREDIT_TITLE : BANK_TRANSFER_TITLE}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close add money"
          onPress={onResetFund}
          style={[styles.closeButton, { backgroundColor: colors.muted }]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>

      {returnToSavings ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Funding adds money to your wallet. After it is credited, return to
          this savings plan and confirm the transfer. Re-enter the amount if
          needed.
        </Text>
      ) : null}

      {storeCreditTopUp ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {STORE_CREDIT_SUBTITLE}
        </Text>
      ) : fundingAccount ? (
        <>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {fundingAccount.provider === 'piggyvest'
              ? 'Transfer to your account number below. Your wallet updates after PiggyVest confirms receipt.'
              : BANK_TRANSFER_SUBTITLE}
          </Text>
          <View
            style={[
              styles.accountCard,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
          >
            <View style={styles.accountCopy}>
              <Text
                style={[styles.accountBank, { color: colors.textSecondary }]}
              >
                {fundingAccount.bankName}
              </Text>
              <Text style={[styles.accountNumber, { color: colors.text }]}>
                {fundingAccount.accountNumber}
              </Text>
              <Text
                style={[styles.accountName, { color: colors.textSecondary }]}
              >
                {fundingAccount.accountName}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy wallet account number"
              accessibilityHint="Copies your account number"
              style={[
                styles.accountCopyButton,
                { backgroundColor: colors.card },
              ]}
              onPress={() => copyToClipboard(fundingAccount.accountNumber)}
            >
              <Ionicons name="copy-outline" size={18} color={colors.primary} />
            </Pressable>
          </View>
          <WalletProviderAttribution
            provider={fundingAccount.provider}
            color={colors.textSecondary}
          />
          {copyFeedback ? (
            <Text
              accessibilityRole="text"
              style={[styles.copyFeedback, { color: colors.textSecondary }]}
            >
              {copyFeedback}
            </Text>
          ) : null}
          <WalletCreditCheckPanel
            accentColor={colors.primary}
            textColor={colors.text}
            watch={creditWatch}
          />
        </>
      ) : needsPhone ? (
        // No account yet and the only blocker is a missing phone — collect it
        // here (takes priority over the spinner/message branches below).
        <WalletFundPhonePrompt colors={colors} onSubmit={onSubmitPhone} />
      ) : autoCreateFailed ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {SETUP_FAILED}
        </Text>
      ) : !openedWithPrefill &&
        fundAmount === '' &&
        (isCreatingFundingAccount || canCreateFundingAccount) ? (
        // Only while the empty-amount auto-create flow is pending. Prefilled
        // opens never auto-create (even after the input is cleared), so they
        // must not show this spinner above the card entry form.
        <View style={styles.settingUpRow}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {SETTING_UP_ACCOUNT}
          </Text>
        </View>
      ) : createFundingAccountUnavailableMessage ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {createFundingAccountUnavailableMessage}
        </Text>
      ) : null}

      {hideCardFunding ? null : cardEntryVisible ? (
        <WalletCardTopUpForm
          colors={colors}
          fundAmount={fundAmount}
          isFundPending={isFundPending}
          onChangeFundAmount={onChangeFundAmount}
          onConfirmFund={onConfirmFund}
          subtitle={storeCreditTopUp ? STORE_CREDIT_CARD_SUBTITLE : undefined}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={CARD_TOGGLE_LABEL}
          style={[styles.cardToggle, { borderColor: colors.border }]}
          onPress={() => setShowCardEntry(true)}
        >
          <Ionicons name="card-outline" size={16} color={colors.primary} />
          <Text style={[styles.cardToggleText, { color: colors.primary }]}>
            {CARD_TOGGLE_LABEL}
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
