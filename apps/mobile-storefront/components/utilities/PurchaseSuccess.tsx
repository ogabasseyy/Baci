import Ionicons from '@react-native-vector-icons/ionicons';
import { type Href, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import PurchaseCashbackCard from './PurchaseCashbackCard';
import PurchaseUpsellCard from './PurchaseUpsellCard';
import PurchaseVoucherCard from './PurchaseVoucherCard';
import { styles } from './purchase-success.styles';
import {
  getPurchaseMessage,
  getPurchasePresentation,
  getReceiptStatus,
  isTokenGeneratingType,
  type PurchaseStatus,
} from './purchase-success-presentation';
import ReceiptShareButton from './ReceiptShareButton';

interface CashbackInfo {
  amount: number;
  newBalance: number;
}

interface PurchaseSuccessProps {
  type: string;
  amount?: number;
  address?: string | null;
  phoneNumber?: string;
  customerIdentifier?: string;
  txReference: string | null;
  cashback: CashbackInfo | null;
  isAuthenticated: boolean;
  onCreateAccount: () => void;
  status?: PurchaseStatus;
  voucherPin?: string | null;
  /** Refund proof: failed WITHOUT this flag must not claim a refund. */
  refundConfirmed?: boolean | null;
  /** Refund deliberately skipped (nothing taken): no-charge copy. */
  refundSkipped?: boolean | null;
}

export function PurchaseSuccess({
  type,
  amount,
  address,
  phoneNumber,
  customerIdentifier,
  txReference,
  cashback,
  isAuthenticated,
  onCreateAccount,
  status = 'successful',
  voucherPin,
  refundConfirmed,
  refundSkipped,
}: PurchaseSuccessProps) {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const identifier = phoneNumber || customerIdentifier || '';
  const presentation = getPurchasePresentation(status);
  const receiptStatus = getReceiptStatus(status);
  const messageText = getPurchaseMessage({
    identifier,
    refundConfirmed,
    refundSkipped,
    status,
    type,
  });
  const isTokenGenerating = isTokenGeneratingType(type);
  const processingNoticeTitle = isTokenGenerating
    ? 'Generating your token'
    : 'Completing your purchase';
  const processingNoticeText = isTokenGenerating
    ? "This usually takes 30-60 seconds. You can leave this screen; we'll notify you when the token is ready."
    : "This can take a minute. You can leave this screen; we'll update your purchase history when it is ready.";

  return (
    <Animated.View entering={FadeIn} style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons
          name={presentation.iconName}
          size={80}
          color={BRAND.primary}
        />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>
        {presentation.title}
      </Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        {messageText}
      </Text>

      {status === 'successful' ? (
        <Text style={[styles.referenceText, { color: colors.textSecondary }]}>
          Ogabassey Never Disappoints!
        </Text>
      ) : txReference ? (
        // Any non-success state (processing/failed/error/cancelled): show the
        // transaction reference so the buyer can quote it while it settles or to
        // support — the celebratory slogan would be premature or wrong here.
        <Text style={[styles.referenceText, { color: colors.textSecondary }]}>
          Ref: {txReference}
        </Text>
      ) : null}

      {presentation.isProcessing ? (
        <View
          style={[
            styles.processingNotice,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.processingNoticeHeader}>
            <Ionicons name="flash-outline" size={18} color={BRAND.primary} />
            <Text
              style={[styles.processingNoticeTitle, { color: colors.text }]}
            >
              {processingNoticeTitle}
            </Text>
          </View>
          <Text
            style={[
              styles.processingNoticeText,
              { color: colors.textSecondary },
            ]}
          >
            {processingNoticeText}
          </Text>
        </View>
      ) : null}

      {voucherPin ? (
        <PurchaseVoucherCard colors={colors} voucherPin={voucherPin} />
      ) : null}

      {cashback ? <PurchaseCashbackCard cashback={cashback} /> : null}

      {!isAuthenticated ? (
        <PurchaseUpsellCard colors={colors} onCreateAccount={onCreateAccount} />
      ) : null}

      {presentation.canShareReceipt && receiptStatus ? (
        <ReceiptShareButton
          address={address ?? undefined}
          amount={amount}
          colors={colors}
          identifier={identifier}
          status={receiptStatus}
          txReference={txReference}
          type={type}
          voucherPin={voucherPin ?? undefined}
        />
      ) : null}

      <Pressable
        style={[styles.secondaryButton, { borderColor: colors.border }]}
        onPress={() => router.push('/' as Href)}
      >
        <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
          Back to Home
        </Text>
      </Pressable>
    </Animated.View>
  );
}
