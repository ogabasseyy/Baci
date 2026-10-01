import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { Product } from '@/types/product';
import { formatVariantAxisLabel } from '@/types/product';
import { toSelectedProductChoice } from './savings/start-savings-controller.utils';
import { walletSavingsDeviceSwapModalStyles as styles } from './wallet-savings-device-swap-modal.styles';

type WalletColors = (typeof Colors)['light'];

type WalletSavingsDeviceSwapModalProps = {
  colors: WalletColors;
  currentAmount: number;
  isLoading: boolean;
  isPending: boolean;
  onClose: () => void;
  onSearchChange: (value: string) => void;
  onSelectDevice: (product: Product, variantId?: string | null) => void;
  products: Product[];
  searchValue: string;
  visible: boolean;
};

type DeviceRow = {
  image: string;
  key: string;
  meta: string[];
  price: number;
  product: Product;
  title: string;
  variantId: string | null;
  variantLabel: string | null;
};

function getVariantMeta(product: Product, variantId?: string | null) {
  const choice = toSelectedProductChoice({ product, variantId });
  return [choice.conditionLabel, choice.variantLabel].filter(
    (value): value is string => Boolean(value)
  );
}

function getVariantLabel(attributes: Record<string, string> | undefined) {
  const parts = Object.entries(attributes ?? {})
    .filter(([axis, value]) => axis !== 'color' && axis !== 'colour' && value)
    .map(([axis, value]) => {
      const axisLabel = formatVariantAxisLabel(axis) ?? axis;
      return `${axisLabel}: ${value}`;
    });

  return parts.length > 0 ? parts.join(' · ') : null;
}

function getDeviceRows(product: Product): DeviceRow[] {
  if (product.variants?.length) {
    return product.variants.map((variant) => ({
      image: variant.image ?? variant.images?.[0] ?? product.image,
      key: `${product.id}:${variant.id}`,
      meta: getVariantMeta(product, variant.id),
      price: variant.price,
      product,
      title: product.name,
      variantId: variant.id,
      variantLabel: getVariantLabel(variant.attributes),
    }));
  }

  return [
    {
      image: product.image,
      key: `${product.id}:default`,
      meta: getVariantMeta(product),
      price: product.price,
      product,
      title: product.name,
      variantId: null,
      variantLabel: null,
    },
  ];
}

export function WalletSavingsDeviceSwapModal({
  colors,
  currentAmount,
  isLoading,
  isPending,
  onClose,
  onSearchChange,
  onSelectDevice,
  products,
  searchValue,
  visible,
}: WalletSavingsDeviceSwapModalProps) {
  return (
    <ModalSheet
      visible={visible}
      animationType="slide"
      backdropStyle={styles.backdrop}
      cardStyle={[styles.card, { backgroundColor: colors.background }]}
      onBackdropPress={onClose}
      onRequestClose={onClose}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>
          Change savings device
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close change savings device"
          onPress={onClose}
          style={styles.iconButton}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
        Choose another device for this same savings balance.
      </Text>
      <Text style={styles.savedAmount}>
        Already saved: {formatNgnCurrency(currentAmount)}
      </Text>

      <TextInput
        accessibilityRole="search"
        accessibilityLabel="Savings replacement device search"
        value={searchValue}
        onChangeText={onSearchChange}
        placeholder="Search devices"
        placeholderTextColor={colors.placeholder}
        style={[
          styles.input,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
      />

      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading devices...
          </Text>
        ) : products.length === 0 ? (
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            No matching devices found.
          </Text>
        ) : (
          products.flatMap(getDeviceRows).map((row) => {
            const isTooCheap = row.price < currentAmount;
            const accessibilityLabel = `Select ${row.title}${
              row.variantLabel ? ` ${row.variantLabel}` : ''
            }`;
            return (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{
                  disabled: isPending || isTooCheap,
                  busy: isPending,
                }}
                disabled={isPending || isTooCheap}
                onPress={() => onSelectDevice(row.product, row.variantId)}
                style={[
                  styles.row,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                  isTooCheap ? styles.rowDisabled : null,
                ]}
              >
                <View
                  style={[styles.imagePane, { backgroundColor: colors.muted }]}
                >
                  {row.image ? (
                    <Image
                      accessibilityLabel={row.title}
                      source={createSafeBoundedImageSource({
                        height: 58,
                        uri: row.image,
                        width: 48,
                      })}
                      style={styles.image}
                      contentFit="contain"
                      autoplay={false}
                    />
                  ) : (
                    <Ionicons
                      name="phone-portrait-outline"
                      size={26}
                      color={colors.textSecondary}
                    />
                  )}
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>
                    {row.title}
                  </Text>
                  {row.meta.length > 0 ? (
                    <Text
                      style={[styles.rowMeta, { color: colors.textSecondary }]}
                    >
                      {row.meta.join(' · ')}
                    </Text>
                  ) : null}
                  <Text style={styles.rowPrice}>
                    {formatNgnCurrency(row.price)}
                  </Text>
                  {isTooCheap ? (
                    <Text
                      style={[styles.rowMeta, { color: colors.textSecondary }]}
                    >
                      Choose a device priced at or above your saved amount.
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </ModalSheet>
  );
}
