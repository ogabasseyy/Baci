import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type Colors from '@/constants/Colors';
import { BRAND, palette } from '@/constants/Colors';
import { setClipboardString } from '@/lib/clipboard';
import type { useCartStore } from '@/stores/cart-store';
import { checkoutScreenViewStyles as styles } from './CheckoutScreenView.styles';

type ColorsScheme = (typeof Colors)['light'];

interface CryptoPayment {
  orderId: string;
  orderNumber: string;
  address: string;
  chain: string;
  currency: string;
  amount: number;
  cryptoAmount: string;
  confirmationTime: string;
  reference: string;
  paymentId: string;
  trackingToken?: string;
}

interface CheckoutCryptoPaymentModalProps {
  clearCart: ReturnType<typeof useCartStore.getState>['clearCart'];
  colors: ColorsScheme;
  cryptoPayment: CryptoPayment | null;
  onChangeSelection: () => void;
  onClosePayment: () => void;
}

export function CheckoutCryptoPaymentModal({
  clearCart,
  colors,
  cryptoPayment,
  onChangeSelection,
  onClosePayment,
}: CheckoutCryptoPaymentModalProps) {
  const [copiedCryptoField, setCopiedCryptoField] = useState<string | null>(
    null
  );
  const cryptoCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (cryptoCopyTimerRef.current) clearTimeout(cryptoCopyTimerRef.current);
    },
    []
  );

  if (!cryptoPayment) return null;

  const cryptoChainLabel = getCryptoChainLabel(cryptoPayment.chain);

  const copyAddress = async () => {
    const success = await setClipboardString(cryptoPayment.address);
    if (!success) return;
    setCopiedCryptoField('address');
    if (cryptoCopyTimerRef.current) clearTimeout(cryptoCopyTimerRef.current);
    cryptoCopyTimerRef.current = setTimeout(
      () => setCopiedCryptoField(null),
      2000
    );
  };

  const completePayment = async () => {
    await clearCart();
    const { orderId, orderNumber, trackingToken } = cryptoPayment;
    onClosePayment();
    router.replace({
      pathname: '/order-success',
      params: {
        orderId,
        orderNumber,
        paymentMethod: 'juicyway',
        ...(trackingToken && { trackingToken }),
      },
    });
  };

  const requestClosePayment = () => {
    Alert.alert(
      'Close Payment?',
      "If you've already sent crypto, your order will still be processed once the payment is detected on the blockchain.",
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Close', onPress: onClosePayment },
      ]
    );
  };

  return (
    <Modal
      visible
      animationType="slide"
      transparent={false}
      onRequestClose={requestClosePayment}
    >
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={[styles.cryptoHeader, { backgroundColor: BRAND.primary }]}>
          <View style={styles.cryptoHeaderLeft}>
            <Pressable
              onPress={onChangeSelection}
              style={styles.cryptoBackBtn}
              accessibilityLabel="Change network or coin"
              accessibilityRole="button"
            >
              <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.cryptoHeaderTitle}>Pay with Crypto</Text>
          </View>
          <Pressable
            onPress={requestClosePayment}
            style={styles.cryptoCloseBtn}
            accessibilityRole="button"
            accessibilityLabel="Close payment modal"
            accessibilityHint="Closes this crypto payment view without cancelling blockchain detection."
          >
            <Ionicons name="close" size={18} color="#FFFFFF" />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.cryptoContent}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[styles.cryptoAmountCard, { backgroundColor: colors.card }]}
          >
            <Text
              style={[
                styles.cryptoAmountLabel,
                { color: colors.textSecondary },
              ]}
            >
              Send Exactly
            </Text>
            <Text style={[styles.cryptoAmountValue, { color: colors.text }]}>
              {cryptoPayment.cryptoAmount ||
                (cryptoPayment.amount / 100).toLocaleString()}{' '}
              <Text style={{ color: BRAND.primary }}>
                {cryptoPayment.currency}
              </Text>
            </Text>
            <View style={styles.cryptoChainBadge}>
              <View style={styles.cryptoPulseDot} />
              <Text style={styles.cryptoChainText}>
                Network: {cryptoChainLabel}
              </Text>
            </View>
          </View>

          <View
            style={[styles.cryptoAddressCard, { backgroundColor: colors.card }]}
          >
            <Text style={styles.cryptoFieldLabel}>RECIPIENT ADDRESS</Text>
            <View style={styles.cryptoAddressRow}>
              <Text
                style={[styles.cryptoAddressText, { color: colors.text }]}
                selectable
                numberOfLines={2}
              >
                {cryptoPayment.address}
              </Text>
              <Pressable
                style={[
                  styles.cryptoCopyBtn,
                  {
                    backgroundColor:
                      copiedCryptoField === 'address'
                        ? `${palette.emerald[500]}15`
                        : `${BRAND.primary}15`,
                  },
                ]}
                onPress={copyAddress}
                accessibilityRole="button"
                accessibilityLabel="Copy crypto address"
                accessibilityHint="Copies the recipient wallet address to the clipboard."
              >
                <Ionicons
                  name={
                    copiedCryptoField === 'address'
                      ? 'checkmark'
                      : 'copy-outline'
                  }
                  size={18}
                  color={
                    copiedCryptoField === 'address' ? '#059669' : BRAND.primary
                  }
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.cryptoWarning}>
            <Ionicons name="warning" size={18} color="#F59E0B" />
            <Text style={styles.cryptoWarningText}>
              Only send {cryptoPayment.currency} on the {cryptoChainLabel}{' '}
              network. Using the wrong network will result in permanent loss.
            </Text>
          </View>

          {cryptoPayment.confirmationTime ? (
            <View
              style={[
                styles.cryptoInfoCard,
                { backgroundColor: `${BRAND.primary}10` },
              ]}
            >
              <Ionicons name="time-outline" size={18} color={BRAND.primary} />
              <Text
                style={[styles.cryptoInfoText, { color: colors.textSecondary }]}
              >
                Expected confirmation: {cryptoPayment.confirmationTime}
              </Text>
            </View>
          ) : null}

          {cryptoPayment.reference ? (
            <Text
              style={[styles.cryptoReference, { color: colors.textSecondary }]}
            >
              Ref: {cryptoPayment.reference}
            </Text>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.cryptoBottomAction,
            { backgroundColor: colors.card, borderTopColor: colors.border },
          ]}
        >
          <Pressable
            style={[styles.cryptoDoneBtn, { backgroundColor: BRAND.primary }]}
            onPress={completePayment}
          >
            <Text style={styles.cryptoDoneBtnText}>I've Sent the Payment</Text>
          </Pressable>
          <Text
            style={[styles.cryptoHelpText, { color: colors.textSecondary }]}
          >
            Tap above after sending. Your order will be confirmed once the
            payment is detected on the blockchain.
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function getCryptoChainLabel(chain: string): string {
  return (
    {
      TRX: 'Tron (TRC-20)',
      ETH: 'Ethereum (ERC-20)',
      MATIC: 'Polygon',
      AVAXC: 'Avalanche C-Chain',
    }[chain] || chain
  );
}
