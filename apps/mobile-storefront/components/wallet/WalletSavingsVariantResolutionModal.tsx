import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import type { WalletSavingsVariantResolutionOption } from '@/hooks/wallet-query';

type WalletColors = (typeof Colors)['light'];

type WalletSavingsVariantResolutionModalProps = {
  colors: WalletColors;
  onClose: () => void;
  onResolve: (variantId: string) => Promise<boolean>;
  options: WalletSavingsVariantResolutionOption[];
  visible: boolean;
};

export function WalletSavingsVariantResolutionModal({
  colors,
  onClose,
  onResolve,
  options,
  visible,
}: WalletSavingsVariantResolutionModalProps) {
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const sessionRef = useRef(0);

  useEffect(() => {
    if (!visible) {
      sessionRef.current += 1;
    }
  });

  const resolveVariant = async (variantId: string) => {
    if (pendingRef.current) {
      return;
    }
    const session = sessionRef.current;
    pendingRef.current = true;
    setIsPending(true);
    try {
      if ((await onResolve(variantId)) && session === sessionRef.current) {
        onClose();
      }
    } catch {
      if (session === sessionRef.current) {
        Alert.alert(
          'Unable to resolve variant',
          'Please try again or refresh your savings goal.'
        );
      }
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onBackdropPress={() => {
        if (!pendingRef.current) onClose();
      }}
      onRequestClose={() => {
        if (!pendingRef.current) onClose();
      }}
    >
      <View style={{ gap: 16, padding: 20 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>
          Choose the exact device variant
        </Text>
        <Text style={{ color: colors.textSecondary }}>
          Select the matching variant to continue this completed savings goal.
        </Text>
        <ScrollView keyboardShouldPersistTaps="handled">
          {options.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>
              No eligible variants are available. Refresh and contact support if
              this continues.
            </Text>
          ) : (
            options.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`Resolve savings variant ${option.label}`}
                accessibilityState={{ busy: isPending, disabled: isPending }}
                disabled={isPending}
                onPress={() => void resolveVariant(option.id)}
                style={{
                  borderColor: colors.border,
                  borderWidth: 1,
                  marginBottom: 8,
                  padding: 14,
                }}
              >
                <Text style={{ color: colors.text }}>{option.label}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </ModalSheet>
  );
}
