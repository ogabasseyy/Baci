import Ionicons from '@react-native-vector-icons/ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { z } from 'zod';
import { CryptoPaymentView } from '@/components/crypto-payment/CryptoPaymentView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { setClipboardString } from '@/lib/clipboard';
import { useCartStore } from '@/stores/cart-store';

const copyToClipboard = async (text: string) => {
  return await setClipboardString(text);
};

const CryptoPaymentParamsSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  orderNumber: z.string().optional(),
  reference: z.string().min(1, 'Reference is required'),
  amount: z.string().min(1, 'Amount is required'),
  address: z.string().min(1, 'Wallet address is required'),
  chain: z.string().min(1, 'Chain is required'),
  currency: z.string().min(1, 'Currency is required'),
  cryptoAmount: z.string().optional(),
  confirmationTime: z.string().optional(),
});

const CHAIN_LABELS: Record<string, string> = {
  TRX: 'Tron (TRC-20)',
  ETH: 'Ethereum (ERC-20)',
  MATIC: 'Polygon',
  AVAXC: 'Avalanche C-Chain',
};

const HEADER_CLOSE_STYLE = { padding: 8 } as const;

const handleClose = (): void => {
  Alert.alert(
    'Leave Payment?',
    'Your order has been created. You can complete the crypto payment using the wallet address shown. Make sure to copy it before leaving.',
    [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => router.back(),
      },
    ]
  );
};

export default function CryptoPaymentScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const params = useLocalSearchParams<Record<string, string>>();
  const clearCart = useCartStore((state) => state.clearCart);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(1800); // 30 minutes

  const validatedParams = (() => {
    const result = CryptoPaymentParamsSchema.safeParse(params);
    if (!result.success) {
      return {
        isValid: false,
        error: result.error.issues[0]?.message || 'Invalid parameters',
        data: null,
      };
    }
    return { isValid: true, error: null, data: result.data };
  })();

  const {
    orderId,
    orderNumber,
    amount,
    address,
    chain,
    currency,
    cryptoAmount,
    confirmationTime,
  } = validatedParams.data || {};

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleCopy = async (text: string, field: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleDone = async () => {
    await clearCart();
    router.replace({
      pathname: '/order-success',
      params: {
        orderId,
        orderNumber: orderNumber || '',
        paymentMethod: 'juicyway',
      },
    });
  };

  const chainLabel = CHAIN_LABELS[chain || ''] || chain || 'Unknown';

  return (
    <>
      <Stack.Screen
        options={
          validatedParams.isValid
            ? {
                title: 'Crypto Payment',
                headerShown: true,
                headerLeft: () => (
                  <Pressable
                    accessibilityLabel="Close crypto payment"
                    accessibilityRole="button"
                    onPress={handleClose}
                    style={HEADER_CLOSE_STYLE}
                  >
                    <Ionicons name="close" size={24} color={colors.text} />
                  </Pressable>
                ),
              }
            : { headerShown: false }
        }
      />
      <CryptoPaymentView
        address={address}
        amount={amount}
        chain={chain}
        chainLabel={chainLabel}
        colors={colors}
        confirmationTime={confirmationTime}
        copiedField={copiedField}
        countdown={countdown}
        cryptoAmount={cryptoAmount}
        currency={currency}
        error={validatedParams.error}
        isValid={validatedParams.isValid}
        onBack={() => router.back()}
        onCopyAddress={() => handleCopy(address || '', 'address')}
        onDone={handleDone}
      />
    </>
  );
}
