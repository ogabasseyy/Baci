import {
  ProductRequestSubmitError,
  submitProductRequest,
} from '@baci/shared/lib';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import type Colors from '@/constants/Colors';
import { MERCHANT_SLUG } from '@/hooks/product-utils';
import { resolveApiBaseUrl } from '@/lib/api-url';

const PRODUCT_REQUESTS_ENDPOINT = `${resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
)}/api/storefront/product-requests`;
export default function ProductRequest({
  query,
  colors,
}: {
  query: string;
  colors: (typeof Colors)['light'];
}) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState(query);
  const [contact, setContact] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const request = useRef({ key: '', id: '' });
  const sending = useRef(false);
  const { height } = useWindowDimensions();
  async function submit() {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setError('');
    try {
      const key = JSON.stringify([product.trim(), contact.trim()]);
      if (request.current.key !== key)
        request.current = { key, id: randomUUID() };
      await submitProductRequest(PRODUCT_REQUESTS_ENDPOINT, {
        query: product,
        contact,
        merchantSlug: MERCHANT_SLUG,
        requestId: request.current.id,
      });
      setSent(true);
      setOpen(false);
      Keyboard.dismiss();
    } catch (error) {
      setError(
        error instanceof ProductRequestSubmitError && error.status === 429
          ? 'Too many requests. Please try again later.'
          : error instanceof ProductRequestSubmitError && error.status === 409
            ? 'This request conflicts with an earlier one. Please try again.'
            : 'Couldn’t send. Check the product name and email or phone number, then try again.'
      );
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  const button = {
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  };
  return (
    <>
      {sent ? (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          Request sent to the store. They may contact you if they can source it.
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Request this product"
          onPress={() => {
            Keyboard.dismiss();
            setOpen(true);
          }}
          style={button}
        >
          <Text style={{ color: colors.text }}>Request this product</Text>
        </Pressable>
      )}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!pending) setOpen(false);
        }}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        >
          <AppKeyboardContainer style={{ justifyContent: 'flex-end' }}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{
                flexGrow: 0,
                maxHeight: height * 0.72,
                backgroundColor: colors.card,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
              }}
              contentContainerStyle={{ padding: 24, gap: 12 }}
            >
              <Text
                accessibilityRole="header"
                style={{ color: colors.text, fontWeight: '600', fontSize: 20 }}
              >
                Request a product
              </Text>
              <Text style={{ color: colors.textSecondary }}>
                Share what you need and how the store can contact you. This is a
                request, not an order. Your request and contact details stay in
                the store’s inbox so the merchant can follow up.
              </Text>
              <TextInput
                accessibilityLabel="Requested product"
                value={product}
                onChangeText={setProduct}
                maxLength={120}
                style={[button, { color: colors.text }]}
                editable={!pending}
              />
              <TextInput
                accessibilityLabel="Email or phone number"
                placeholder="Email or phone number"
                placeholderTextColor={colors.placeholder}
                value={contact}
                onChangeText={setContact}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={160}
                style={[button, { color: colors.text }]}
                editable={!pending}
              />
              {error && (
                <Text accessibilityRole="alert" style={{ color: colors.text }}>
                  {error}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send product request"
                disabled={pending}
                onPress={() => void submit()}
                style={[button, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: colors.primaryForeground }}>
                  {pending ? 'Sending…' : 'Send request'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel product request"
                disabled={pending}
                onPress={() => setOpen(false)}
                style={button}
              >
                <Text style={{ color: colors.text }}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </AppKeyboardContainer>
        </View>
      </Modal>
    </>
  );
}
