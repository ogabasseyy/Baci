import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { useCartStore } from '@/stores/cart-store';
import { StickyAssuranceDefaultNote } from './StickyAssuranceDefaultNote';

const mockConfig: { merchantSlug: string; smartCartProEnabled: boolean } = {
  merchantSlug: 'ogabassey',
  smartCartProEnabled: true,
};
jest.mock('@/lib/config', () => ({
  CONFIG: {
    get MERCHANT_SLUG() {
      return mockConfig.merchantSlug;
    },
    get ENABLE_SMART_CART_PRO() {
      return mockConfig.smartCartProEnabled;
    },
  },
}));

const mockSettings: { data: unknown } = {
  data: { shipping_insurance_enabled: true },
};
jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  useMerchantPaymentSettings: () => mockSettings,
}));

describe('StickyAssuranceDefaultNote', () => {
  beforeEach(() => {
    mockConfig.merchantSlug = 'ogabassey';
    mockConfig.smartCartProEnabled = true;
    mockSettings.data = { shipping_insurance_enabled: true };
  });

  it('discloses the default for a fresh purchasable add', () => {
    render(
      <StickyAssuranceDefaultNote
        canPurchase
        quantityInCart={0}
        colors={Colors.light}
      />
    );
    expect(screen.getByTestId('assurance-default-note')).toBeTruthy();
  });

  it.each([
    {
      label: 'not purchasable',
      canPurchase: false,
      quantityInCart: 0,
      data: { shipping_insurance_enabled: true },
      merchantSlug: 'ogabassey',
    },
    {
      label: 'line already in cart',
      canPurchase: true,
      quantityInCart: 1,
      data: { shipping_insurance_enabled: true },
      merchantSlug: 'ogabassey',
    },
    {
      label: 'insurance setting unknown',
      canPurchase: true,
      quantityInCart: 0,
      data: undefined,
      merchantSlug: 'ogabassey',
    },
    {
      label: 'insurance disabled',
      canPurchase: true,
      quantityInCart: 0,
      data: { shipping_insurance_enabled: false },
      merchantSlug: 'ogabassey',
    },
    {
      label: 'other merchant',
      canPurchase: true,
      quantityInCart: 0,
      data: { shipping_insurance_enabled: true },
      merchantSlug: 'another-store',
    },
  ])('renders nothing when $label', ({
    canPurchase,
    quantityInCart,
    data,
    merchantSlug,
  }) => {
    mockSettings.data = data;
    mockConfig.merchantSlug = merchantSlug;
    render(
      <StickyAssuranceDefaultNote
        canPurchase={canPurchase}
        quantityInCart={quantityInCart}
        colors={Colors.light}
      />
    );
    expect(screen.queryByTestId('assurance-default-note')).toBeNull();
  });

  it('reconciles lines stamped pending while the setting was unknown', () => {
    // Cold deep link to this PDP never mounts the tab layout's
    // warm-up; the note must flip pending lines itself when the
    // setting resolves affirmative.
    useCartStore.setState({
      items: [
        {
          id: 'line-pending',
          product_id: 'product-1',
          slug: 'slug-1',
          name: 'Widget',
          price: 100,
          quantity: 1,
          hasAssurance: false,
          assurancePendingSetting: true,
        },
      ],
    });
    mockSettings.data = { shipping_insurance_enabled: true };
    render(
      <StickyAssuranceDefaultNote
        canPurchase
        quantityInCart={0}
        colors={Colors.light}
      />
    );
    expect(useCartStore.getState().items[0]).toMatchObject({
      hasAssurance: true,
      assurancePendingSetting: undefined,
    });
    useCartStore.setState({ items: [] });
  });
});
