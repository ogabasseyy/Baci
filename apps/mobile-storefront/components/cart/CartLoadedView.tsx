import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { AdSlot } from '@/components/ads/AdSlot';
import { CheckoutIdentityModal } from '@/components/checkout/checkout-identity';
import { PatternedBackground } from '@/components/storefront/PatternedBackground';
import type Colors from '@/constants/Colors';
import { palette, SPACING } from '@/constants/Colors';
import { MODAL_DISMISS_FALLBACK_MS } from '@/constants/modal-dismiss';
import type { CartItem } from '@/stores/cart-store';
import { useUIStore } from '@/stores/ui-store';
import CartCheckoutFooter from './CartCheckoutFooter';
import CartItemCard from './CartItemCard';
import NegotiationWarningModal from './NegotiationWarningModal';
import styles from './styles';

interface CartLoadedViewProps {
  colorScheme: 'light' | 'dark';
  colors: (typeof Colors)['light'];
  enableNegotiationModal: boolean;
  formatPrice: (amount: number) => string;
  grandTotal: number;
  handleCheckout: () => void;
  handleClearCart: () => void;
  handleReturnHome: () => void;
  handleQuantityChange: (item: CartItem, delta: number) => void;
  handleRemoveItem: (item: CartItem) => void;
  hasNonNegotiableCartItem: boolean;
  insetsTop: number;
  isIdentityModalOpen: boolean;
  isPriceChangeModalOpen: boolean;
  itemCount: number;
  items: CartItem[];
  onCloseIdentityModal: () => void;
  onCloseNegotiateWarning: () => void;
  onCheckoutPressIn: () => void;
  onBulkNegotiate: () => void;
  onNegotiateItem: (item: CartItem) => void;
  onNegotiateTotal: () => void;
  onOpenItemNegotiation: (item: CartItem) => void;
  pendingNegotiateItem: CartItem | null;
  removeClippedSubviews: boolean;
  showNegotiateWarning: boolean;
  toggleAssurance: (itemId: string) => void;
  triggerHaptic: () => void;
  updateQuantity: (itemId: string, quantity: number) => void;
}

const CART_ITEM_FULL_HEIGHT = 250 + SPACING.md;

function getItemLayout(
  _data: ArrayLike<CartItem> | null | undefined,
  index: number
) {
  return {
    length: CART_ITEM_FULL_HEIGHT,
    offset: CART_ITEM_FULL_HEIGHT * index,
    index,
  };
}

export default function CartLoadedView({
  colorScheme,
  colors,
  enableNegotiationModal,
  formatPrice,
  grandTotal,
  handleCheckout,
  handleClearCart,
  handleReturnHome,
  handleQuantityChange,
  handleRemoveItem,
  hasNonNegotiableCartItem,
  insetsTop,
  isIdentityModalOpen,
  isPriceChangeModalOpen,
  itemCount,
  items,
  onCloseIdentityModal,
  onCloseNegotiateWarning,
  onCheckoutPressIn,
  onBulkNegotiate,
  onNegotiateItem,
  onNegotiateTotal,
  onOpenItemNegotiation,
  pendingNegotiateItem,
  removeClippedSubviews,
  showNegotiateWarning,
  toggleAssurance,
  triggerHaptic,
  updateQuantity,
}: CartLoadedViewProps) {
  const isDark = colorScheme === 'dark';
  const surfaceInset = isDark ? colors.muted : colors.background;
  const disabledIconColor = isDark ? colors.textSecondary : palette.gray[300];
  const negotiateSurface = isDark
    ? 'rgba(220, 38, 38, 0.12)'
    : colors.background;
  const negotiateBorder = isDark
    ? 'rgba(248, 113, 113, 0.35)'
    : palette.red[100];
  const checkoutDotColor = isDark
    ? 'rgba(0, 0, 0, 0.28)'
    : 'rgba(255,255,255,0.4)';
  const hasAcceptedNegotiation = items.some(
    (item) => item.negotiationStatus === 'accepted'
  );
  // iOS keeps the native negotiation modal rendered through its fade
  // dismissal, while the close handler clears the flag synchronously. Hold
  // the ad gate until the modal reports dismissal.
  const [negotiateDismissed, setNegotiateDismissed] = useState(true);
  useEffect(() => {
    if (showNegotiateWarning) setNegotiateDismissed(false);
  }, [showNegotiateWarning]);
  useEffect(() => {
    if (showNegotiateWarning || negotiateDismissed) return undefined;
    const fallback = setTimeout(
      () => setNegotiateDismissed(true),
      MODAL_DISMISS_FALLBACK_MS
    );
    return () => clearTimeout(fallback);
  }, [showNegotiateWarning, negotiateDismissed]);
  const isNegotiateWarningCovering =
    showNegotiateWarning || !negotiateDismissed;
  // The root-level negotiation modal outlives the warning that precedes
  // it — and direct negotiation bypasses the warning entirely — so the
  // slot must stay suppressed for the actual negotiation flow too. The
  // modal reports no dismissal, so the fallback bound covers its fade.
  const isNegotiationModalOpen = useUIStore(
    (state) => state.isNegotiationModalOpen
  );
  const [negotiationDismissed, setNegotiationDismissed] = useState(true);
  useEffect(() => {
    if (isNegotiationModalOpen) setNegotiationDismissed(false);
  }, [isNegotiationModalOpen]);
  useEffect(() => {
    if (isNegotiationModalOpen || negotiationDismissed) return undefined;
    const fallback = setTimeout(
      () => setNegotiationDismissed(true),
      MODAL_DISMISS_FALLBACK_MS
    );
    return () => clearTimeout(fallback);
  }, [isNegotiationModalOpen, negotiationDismissed]);
  const isNegotiationCovering = isNegotiationModalOpen || !negotiationDismissed;

  return (
    <View style={styles.container}>
      <PatternedBackground
        backgroundColor={colors.background}
        isDark={isDark}
      />

      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            paddingTop: insetsTop + SPACING.sm,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <Pressable
            onPress={handleReturnHome}
            hitSlop={12}
            style={[
              styles.backButton,
              { backgroundColor: surfaceInset, borderColor: colors.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Back to home"
          >
            <Ionicons name="arrow-back" size={18} color={colors.text} />
          </Pressable>
          <Ionicons name="cart" size={24} color={colors.primary} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Cart</Text>
          <Text style={[styles.headerCount, { color: colors.textSecondary }]}>
            ({itemCount})
          </Text>
        </View>
        <Pressable
          onPress={handleClearCart}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Clear cart"
        >
          <Text style={[styles.clearText, { color: colors.primary }]}>
            Clear All
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        getItemLayout={getItemLayout}
        removeClippedSubviews={removeClippedSubviews}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={5}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 180 }]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <CartItemCard
            item={item}
            handleQuantityChange={handleQuantityChange}
            handleRemoveItem={handleRemoveItem}
            toggleAssurance={toggleAssurance}
            openItemNegotiation={
              enableNegotiationModal ? onOpenItemNegotiation : undefined
            }
            updateQuantity={updateQuantity}
            formatPrice={formatPrice}
            colors={colors}
            surfaceInset={surfaceInset}
            disabledIconColor={disabledIconColor}
            negotiateSurface={negotiateSurface}
            negotiateBorder={negotiateBorder}
          />
        )}
        ListFooterComponent={
          <>
            {/* Any modal covers this screen; unmount the slot while one is
                visible so no obscured delivery is requested. */}
            {isIdentityModalOpen ||
            isPriceChangeModalOpen ||
            isNegotiateWarningCovering ||
            isNegotiationCovering ? null : (
              <AdSlot placement="CART_MPU" />
            )}
            <View style={styles.secureBadgeInside}>
              <Ionicons
                name="shield-checkmark-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text
                style={[
                  styles.secureBadgeText,
                  { color: colors.textSecondary },
                ]}
              >
                Secure Checkout
              </Text>
            </View>
          </>
        }
      />

      <CartCheckoutFooter
        checkoutDotColor={checkoutDotColor}
        colors={colors}
        enableNegotiationModal={enableNegotiationModal}
        formatPrice={formatPrice}
        grandTotal={grandTotal}
        hasAcceptedNegotiation={hasAcceptedNegotiation}
        hasNonNegotiableItem={hasNonNegotiableCartItem}
        onCheckout={handleCheckout}
        onCheckoutPressIn={onCheckoutPressIn}
        onNegotiateTotal={onNegotiateTotal}
        surfaceInset={surfaceInset}
      />

      <CheckoutIdentityModal
        isOpen={isIdentityModalOpen}
        onClose={onCloseIdentityModal}
      />
      <NegotiationWarningModal
        visible={showNegotiateWarning}
        pendingItem={pendingNegotiateItem}
        hasNonNegotiableCartItem={hasNonNegotiableCartItem}
        onClose={onCloseNegotiateWarning}
        onDismissed={() => setNegotiateDismissed(true)}
        onNegotiateItem={onNegotiateItem}
        onBulkNegotiate={onBulkNegotiate}
        triggerHaptic={triggerHaptic}
        colors={colors}
      />
    </View>
  );
}
