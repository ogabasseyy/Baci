import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdSlot } from '@/components/ads/AdSlot';
import { PatternedBackground } from '@/components/storefront/PatternedBackground';
import type Colors from '@/constants/Colors';
import styles from './styles';

interface CartStateViewProps {
  variant: 'empty' | 'error';
  colorScheme: 'light' | 'dark';
  colors: (typeof Colors)['light'];
  isRetrying: boolean;
  onRetry: () => void;
  onStartShopping: () => void;
  /** Same exit as the loaded cart's back button; omit to hide it. */
  onBack?: () => void;
}

export default function CartStateView({
  variant,
  colorScheme,
  colors,
  isRetrying,
  onRetry,
  onStartShopping,
  onBack,
}: CartStateViewProps) {
  const insets = useSafeAreaInsets();
  const hasError = variant === 'error';
  const surfaceInset =
    colorScheme === 'dark' ? colors.muted : colors.background;

  return (
    <View style={styles.container}>
      <PatternedBackground
        backgroundColor={colors.background}
        isDark={colorScheme === 'dark'}
      />

      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={[
            styles.backButton,
            styles.stateBackButton,
            {
              backgroundColor: surfaceInset,
              borderColor: colors.border,
              top: insets.top + 12,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
        >
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIconBg, { backgroundColor: surfaceInset }]}>
          <Ionicons
            name={hasError ? 'warning-outline' : 'cart'}
            size={56}
            color={colors.primary}
          />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {hasError ? 'Unable to load cart' : 'Your cart is empty 🛒'}
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          {hasError
            ? 'We could not read your cart right now. Please try again.'
            : 'Browse our products and add items to your cart'}
        </Text>
        <Pressable
          style={[styles.shopButton, { backgroundColor: colors.text }]}
          disabled={hasError && isRetrying}
          accessibilityRole="button"
          accessibilityLabel={
            hasError ? 'Retry loading cart' : 'Start shopping'
          }
          accessibilityState={
            hasError ? { disabled: isRetrying, busy: isRetrying } : undefined
          }
          onPress={hasError ? onRetry : onStartShopping}
        >
          <Text style={[styles.shopButtonText, { color: colors.background }]}>
            {hasError && isRetrying
              ? 'Retrying...'
              : hasError
                ? 'Retry'
                : 'Start Shopping'}
          </Text>
          {hasError && isRetrying ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Ionicons
              name={hasError ? 'refresh' : 'arrow-forward'}
              size={18}
              color={colors.background}
            />
          )}
        </Pressable>
        {hasError ? null : <AdSlot placement="FOOTER_ANCHOR" />}
      </View>
    </View>
  );
}
