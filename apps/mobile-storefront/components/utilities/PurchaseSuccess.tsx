import Ionicons from '@react-native-vector-icons/ionicons';
import { type Href, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import PurchaseCashbackCard from './PurchaseCashbackCard';
import PurchaseUpsellCard from './PurchaseUpsellCard';
import PurchaseVoucherCard from './PurchaseVoucherCard';
import { styles } from './purchase-success.styles';
import ReceiptShareButton from './ReceiptShareButton';

interface CashbackInfo {
  amount: number;
  newBalance: number;
}

type PurchaseStatus =
  | 'processing'
  | 'successful'
  | 'failed'
  | 'error'
  | 'cancelled';
type IoniconsName = ComponentProps<typeof Ionicons>['name'];

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
}

const TYPE_LABELS: Record<string, string> = {
  airtime: 'airtime',
  data: 'data',
  tv: 'TV subscription',
  power: 'electricity',
  gaming: 'betting',
};

function isTokenGeneratingType(type: string) {
  return type === 'power' || type === 'tv' || type === 'gaming';
}

function getPurchaseMessage({
  identifier,
  refundConfirmed,
  status,
  type,
}: {
  identifier: string;
  refundConfirmed: boolean | null | undefined;
  status: PurchaseStatus;
  type: string;
}) {
  const typeLabel = TYPE_LABELS[type] || type;

  switch (status) {
    case 'processing': {
      const action = isTokenGeneratingType(type)
        ? 'generating your token'
        : 'completing your purchase';
      return identifier
        ? `Your ${typeLabel} payment for ${identifier} was received. We are ${action} now.`
        : `Your ${typeLabel} payment was received. We are ${action} now.`;
    }
    case 'failed':
      // Wallet-only flow, gated on proof: the refunded claim renders
      // ONLY with refundConfirmed. Without it (a future caller passing
      // failed from route params or a deep link) the copy stays soft.
      if (refundConfirmed === true) {
        return identifier
          ? `Your ${typeLabel} purchase for ${identifier} failed. Your wallet has been refunded — please try again.`
          : `Your ${typeLabel} purchase failed. Your wallet has been refunded — please try again.`;
      }
      return identifier
        ? `Your ${typeLabel} purchase for ${identifier} failed. Please check your wallet balance and try again.`
        : `Your ${typeLabel} purchase failed. Please check your wallet balance and try again.`;
    case 'cancelled':
      return identifier
        ? `Your ${typeLabel} payment for ${identifier} was cancelled.`
        : `Your ${typeLabel} payment was cancelled.`;
    case 'error':
      return identifier
        ? `We could not complete your ${typeLabel} purchase for ${identifier}. Please try again.`
        : `We could not complete your ${typeLabel} purchase. Please try again.`;
    case 'successful':
      return identifier
        ? `Your ${typeLabel} purchase for ${identifier} was successful.`
        : `Your ${typeLabel} purchase was successful.`;
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled purchase status: ${value}`);
}

function getReceiptStatus(
  status: PurchaseStatus
): 'processing' | 'successful' | null {
  switch (status) {
    case 'processing':
      return 'processing';
    case 'successful':
      return 'successful';
    case 'failed':
    case 'error':
    case 'cancelled':
      return null;
    default:
      return assertNever(status);
  }
}

function getPurchasePresentation(status: PurchaseStatus): {
  canShareReceipt: boolean;
  iconName: IoniconsName;
  isProcessing: boolean;
  title: string;
} {
  switch (status) {
    case 'processing':
      return {
        canShareReceipt: true,
        iconName: 'time-outline',
        isProcessing: true,
        title: 'Payment Received',
      };
    case 'failed':
      return {
        canShareReceipt: false,
        iconName: 'alert-circle',
        isProcessing: false,
        title: 'Purchase Failed',
      };
    case 'error':
      return {
        canShareReceipt: false,
        iconName: 'alert-circle',
        isProcessing: false,
        title: 'Purchase Error',
      };
    case 'cancelled':
      return {
        canShareReceipt: false,
        iconName: 'close-circle',
        isProcessing: false,
        title: 'Payment Cancelled',
      };
    case 'successful':
      return {
        canShareReceipt: true,
        iconName: 'checkmark-circle',
        isProcessing: false,
        title: 'Purchase Successful!',
      };
    default:
      return assertNever(status);
  }
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
