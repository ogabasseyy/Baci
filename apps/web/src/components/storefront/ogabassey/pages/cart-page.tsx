'use client';
// Migrated from temp-source/components/CartPage.tsx
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useAuthSafe } from '@/contexts/auth-context';
import { type CartItem, useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import {
  calculateCartTotal,
  isQuizVoucherCartItem,
  sanitizeCartItems,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import { asRoute } from '@/lib/routes';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';
import { isProductNegotiable } from '@baci/shared/lib';
import { AdUnit } from '../components/AdUnit';
import { CheckoutIdentityModal } from '../components/CheckoutIdentityModal';
import {
  deriveCartLineNegotiationProps,
  NegotiationModal,
} from '../components/NegotiationModal';
import { runCartTotalNegotiation } from '../lib/cart-total-negotiation';
import { CartPageEmptySection } from './cart-page-empty-section';
import { CartPageHeader } from './cart-page-header';
import { CartPageLineItem } from './cart-page-line-item';
import { CartPageMobileCheckoutBar } from './cart-page-mobile-checkout-bar';
import { CartPageNegotiationModeDialog } from './cart-page-negotiation-mode-dialog';
import { CartPageSummaryPanel } from './cart-page-summary-panel';

interface NegotiationState {
  isOpen: boolean;
  type: 'single' | 'total';
  item?: CartItem;
  currentPrice: number;
  name: string;
}

interface CartPageProps {
  vatEnabled?: boolean;
  vatRate?: number;
}

export const CartPage: React.FC<CartPageProps> = ({
  vatEnabled = false,
  vatRate = 7.5,
}) => {
  const {
    cart,
    removeFromCart,
    updateQuantity,
    applyNegotiatedPrice,
    applyCartWideNegotiation,
    clearNegotiatedPrice,
    toggleAssurance,
    merchantSlug,
  } = useCart();

  const merchantContext = useMerchantSafe();
  const auth = useAuthSafe();
  const user = auth?.user;

  const merchant = merchantContext?.merchant;
  const settings = merchant?.feature_settings;
  const basePath =
    merchantContext?.basePath ?? `/${merchantSlug || 'ogabassey'}`;
  const negotiationVatRate =
    merchant?.vat_registration_status === 'registered'
      ? (merchant.vat_rate ?? vatRate) / 100
      : vatEnabled
        ? vatRate / 100
        : 0;

  const hasPriceNegotiation = hasStorefrontPriceNegotiation(merchant);

  const displayCart = sanitizeCartItems(cart, hasPriceNegotiation);

  const displayCartTotal = calculateCartTotal(cart, hasPriceNegotiation);

  const hasNonNegotiableCartItem = displayCart.some(
    (item) =>
      !isQuizVoucherCartItem(item) &&
      !isProductNegotiable({ brand: item.brand, name: item.name })
  );

  const [negotiationState, setNegotiationState] =
    useState<NegotiationState | null>(null);
  const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
  const router = useRouter();

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleNegotiationSuccess = (finalPrice: number) => {
    if (!negotiationState) return;

    if (negotiationState.type === 'single' && negotiationState.item) {
      // finalPrice is the negotiated TOTAL for the line item (Unit Price * Quantity)
      // We need to convert it back to Unit Price for the system
      const quantity = negotiationState.item.quantity;
      const newUnitPrice = finalPrice / quantity;
      applyNegotiatedPrice?.(negotiationState.item.cartItemId, newUnitPrice);
    } else if (negotiationState.type === 'total') {
      applyCartWideNegotiation?.(finalPrice);
    }
  };

  // Helper function to actually open item negotiation
  const actuallyOpenItemNegotiation = (item: CartItem) => {
    const currentUnitPrice = item.negotiatedPrice || item.price || 0;
    const currentTotal = currentUnitPrice * item.quantity;

    setNegotiationState({
      isOpen: true,
      type: 'single',
      item: item,
      currentPrice: currentTotal,
      name: item.quantity > 1 ? `${item.name} (x${item.quantity})` : item.name,
    });
    setShowNegotiateWarning(false);
    setPendingNegotiateItem(null);
  };

  // State for negotiate mode warning
  const [showNegotiateWarning, setShowNegotiateWarning] = useState(false);
  const [pendingNegotiateItem, setPendingNegotiateItem] =
    useState<CartItem | null>(null);

  const openItemNegotiation = (item: CartItem) => {
    if (!isProductNegotiable({ brand: item.brand, name: item.name })) {
      return;
    }

    // Check if any item already has individual negotiation
    const hasAnyIndividualNegotiation = displayCart.some(
      (item) => item.negotiatedPrice != null
    );

    // Check if cart-wide discount is active (would need to check cartDiscount in items)
    const hasBulkDiscount = displayCart.some(
      (item) => (item.cartDiscount ?? 0) > 0
    );

    if (hasBulkDiscount) {
      // Bulk mode is active, show error
      alert(
        'You already have a bulk discount applied. Remove it before negotiating items individually.'
      );
      return;
    }

    if (hasAnyIndividualNegotiation) {
      // Already using individual mode, proceed directly
      actuallyOpenItemNegotiation(item);
    } else {
      // First negotiation - show warning modal
      setPendingNegotiateItem(item);
      setShowNegotiateWarning(true);
    }
  };

  const openTotalNegotiation = () => {
    if (hasNonNegotiableCartItem) {
      return;
    }

    runCartTotalNegotiation({
      cart,
      fallbackTotal: displayCartTotal,
      clearNegotiatedPrice,
      confirmReset: () =>
        window.confirm(
          'Negotiating your whole cart will clear the prices you negotiated on individual items. Reset them and continue?'
        ),
      openBulk: (currentPrice) =>
        setNegotiationState({
          isOpen: true,
          type: 'total',
          currentPrice,
          name: 'Entire Cart',
        }),
    });
  };

  const handleCheckoutClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (user) {
      // Logged in user - proceed directly
      router.push(asRoute(`${basePath}/checkout`));
    } else {
      // Guest user - show identity choice
      setIsIdentityModalOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 w-full flex-1 flex flex-col">
        <CartPageHeader cartCount={displayCart.length} />

        {displayCart.length === 0 ? (
          <CartPageEmptySection basePath={basePath || '/'} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
            <div className="lg:col-span-8 space-y-4">
              {displayCart.map((item, index) => (
                <CartPageLineItem
                  key={item.cartItemId || `${item.id}-${index}`}
                  hasPriceNegotiation={hasPriceNegotiation}
                  item={item}
                  merchantSlug={merchantSlug ?? undefined}
                  onOpenItemNegotiation={openItemNegotiation}
                  onRemove={removeFromCart}
                  onToggleAssurance={toggleAssurance}
                  onUpdateQuantity={updateQuantity}
                  productHref={getStorefrontProductHref(item, basePath)}
                  shippingInsuranceEnabled={Boolean(
                    settings?.shipping_insurance_enabled
                  )}
                />
              ))}
              <AdUnit placementKey="PRODUCT_GRID_IN_FEED" />
            </div>

            <CartPageSummaryPanel
              displayCartTotal={displayCartTotal}
              hasNonNegotiableCartItem={hasNonNegotiableCartItem}
              hasPriceNegotiation={hasPriceNegotiation}
              onCheckoutClick={handleCheckoutClick}
              onOpenTotalNegotiation={openTotalNegotiation}
            />
          </div>
        )}
      </div>

      {/* Negotiation Modal — only render when merchant context is available */}
      {negotiationState && merchant?.id && (
        <NegotiationModal
          isOpen={negotiationState.isOpen}
          onClose={() => setNegotiationState(null)}
          productName={negotiationState.name}
          currentPrice={negotiationState.currentPrice}
          vatRate={negotiationVatRate}
          onSuccess={handleNegotiationSuccess}
          type={negotiationState.type}
          merchantId={merchant.id}
          cart={cart}
          {...(negotiationState.type === 'single' && negotiationState.item
            ? deriveCartLineNegotiationProps(negotiationState.item)
            : {})}
        />
      )}

      {/* Checkout Identity Gate */}
      <CheckoutIdentityModal
        isOpen={isIdentityModalOpen}
        onClose={() => setIsIdentityModalOpen(false)}
        checkoutUrl={`${basePath}/checkout`}
      />

      {displayCart.length > 0 && (
        <CartPageMobileCheckoutBar
          displayCartTotal={displayCartTotal}
          hasNonNegotiableCartItem={hasNonNegotiableCartItem}
          hasPriceNegotiation={hasPriceNegotiation}
          onCheckoutClick={handleCheckoutClick}
          onOpenTotalNegotiation={openTotalNegotiation}
        />
      )}
      <CartPageNegotiationModeDialog
        hasNonNegotiableCartItem={hasNonNegotiableCartItem}
        isOpen={showNegotiateWarning}
        onCancel={() => {
          setShowNegotiateWarning(false);
          setPendingNegotiateItem(null);
        }}
        onOpenPendingItem={actuallyOpenItemNegotiation}
        onOpenTotalNegotiation={openTotalNegotiation}
        pendingItem={pendingNegotiateItem}
      />
    </div>
  );
};
