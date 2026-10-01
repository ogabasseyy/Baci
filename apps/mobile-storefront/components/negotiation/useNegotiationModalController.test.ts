import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { CartItem } from '@/stores/cart-store';
import type { useNegotiationModalController as UseNegotiationModalController } from './useNegotiationModalController';

type AuthUserResponse = {
  data: {
    user: { email?: string; id: string; phone?: string | null } | null;
  };
  error?: unknown | null;
};

type InsertResponse = {
  error: unknown | null;
};

const mockLogError = jest.fn<(message: string, error: unknown) => void>();
const mockGetUser = jest.fn<() => Promise<AuthUserResponse>>();
const mockInsert =
  jest.fn<(payload: Record<string, unknown>) => Promise<InsertResponse>>();
const mockFrom = jest.fn(() => ({ insert: mockInsert }));
const mockCreateNegotiationSessionId = jest.fn<() => string>(
  () => 'session-123'
);
const mockUploadNegotiationEvidence =
  jest.fn<(fileUri: string, merchantId: string | null) => Promise<string>>();
const mockEnsureNegotiationNativeModules = jest.fn<() => Promise<void>>();
const mockImpactAsync = jest.fn<(style: string) => Promise<void>>();
const mockLaunchImageLibraryAsync =
  jest.fn<
    (options: {
      mediaTypes: string[];
      quality: number;
    }) => Promise<{ canceled: boolean; assets: Array<{ uri: string }> }>
  >();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: mockLogError,
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  },
}));

jest.mock('./negotiation-evidence', () => ({
  createNegotiationSessionId: mockCreateNegotiationSessionId,
  uploadNegotiationEvidence: mockUploadNegotiationEvidence,
}));

jest.mock('./negotiation-native-modules', () => ({
  ensureNegotiationNativeModules: mockEnsureNegotiationNativeModules,
  getNegotiationHapticsModule: () => ({
    ImpactFeedbackStyle: {
      Heavy: 'Heavy',
      Light: 'Light',
      Medium: 'Medium',
    },
    impactAsync: mockImpactAsync,
  }),
  getNegotiationImagePickerModule: () => ({
    launchImageLibraryAsync: mockLaunchImageLibraryAsync,
  }),
}));

let useNegotiationModalController: typeof UseNegotiationModalController;

beforeAll(async () => {
  ({ useNegotiationModalController } = await import(
    './useNegotiationModalController'
  ));
});

type ControllerParams = Parameters<typeof useNegotiationModalController>[0];

function renderController(overrides: Partial<ControllerParams> = {}) {
  return renderHook(() =>
    useNegotiationModalController({
      currentPrice: 100000,
      itemInfo: {
        currentPrice: 100000,
        id: 'product-1',
        name: 'iPhone 13',
      },
      merchantId: 'merchant-1',
      successMessageFormatter: (price) => `Accepted at ${price}`,
      type: 'single',
      visible: true,
      ...overrides,
    })
  );
}

function createCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'line-1',
    name: 'iPhone 15 Pro',
    price: 1200000,
    product_id: 'product-1',
    quantity: 1,
    slug: 'iphone-15-pro',
    ...overrides,
  };
}

describe('useNegotiationModalController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockInsert.mockResolvedValue({ error: null });
    mockEnsureNegotiationNativeModules.mockResolvedValue(undefined);
    mockImpactAsync.mockResolvedValue(undefined);
    mockLaunchImageLibraryAsync.mockResolvedValue({
      assets: [],
      canceled: true,
    });
    mockUploadNegotiationEvidence.mockResolvedValue(
      'https://proof.example/upload.png'
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('accepts offers within the automatic discount threshold', () => {
    jest.useFakeTimers();
    const onAcceptedPrice = jest.fn<(price: number) => void>();
    const { result } = renderController({ onAcceptedPrice });

    act(() => {
      result.current.handleSubmitOffer(99000);
    });
    expect(result.current.status).toBe('processing');

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    expect(result.current.status).toBe('success');
    expect(result.current.offer).toBe('99000');
    expect(result.current.message).toBe('Accepted at 99000');
    expect(onAcceptedPrice).toHaveBeenCalledWith(99000);
  });

  it('requires evidence before submitting merchant review requests', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = renderController();

    act(() => {
      result.current.openUpload();
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Evidence Required',
      'Please add a photo or link as proof.'
    );
    expect(mockFrom).not.toHaveBeenCalled();
    expect(result.current.status).toBe('upload');
  });

  it('submits single-item review requests with selected variant details', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { email: 'buyer@example.com', id: 'customer-1' } },
    });
    const { result } = renderController({
      itemInfo: {
        brand: 'Apple',
        condition: 'used',
        currentPrice: 875000,
        id: 'cart-line-1',
        name: 'iPhone 14 Pro Max',
        productSlug: 'iphone-14-pro-max',
        variantAttributes: {
          color: 'Deep Purple',
          storage: '256GB',
        },
        variantId: 'variant-purple-256',
        variantName: 'Deep Purple / 256GB',
      },
    });

    act(() => {
      result.current.setOffer('₦820,000');
      result.current.setUploadLink('https://proof.example/offer');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        item_info: {
          brand: 'Apple',
          condition: 'used',
          current_price: 875000,
          id: 'cart-line-1',
          name: 'iPhone 14 Pro Max',
          product_slug: 'iphone-14-pro-max',
          variant_attributes: {
            color: 'Deep Purple',
            storage: '256GB',
          },
          variant_id: 'variant-purple-256',
          variant_name: 'Deep Purple / 256GB',
        },
        offered_price: 820000,
        type: 'single',
      })
    );
  });

  it('drops blank single-item metadata before submitting merchant review requests', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { email: 'buyer@example.com', id: 'customer-1' } },
    });
    const { result } = renderController({
      itemInfo: {
        brand: ' ',
        condition: '',
        currentPrice: 950000,
        id: 'cart-line-1',
        name: 'Samsung Galaxy S26',
        productSlug: ' ',
        variantAttributes: {
          color: ' Silver ',
          empty: ' ',
          ' ': 'ignored',
        },
        variantId: ' variant-silver ',
        variantName: ' Silver ',
      },
    });

    act(() => {
      result.current.setOffer('₦900,000');
      result.current.setUploadLink('https://proof.example/offer');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        item_info: {
          current_price: 950000,
          id: 'cart-line-1',
          name: 'Samsung Galaxy S26',
          variant_attributes: {
            color: 'Silver',
          },
          variant_id: 'variant-silver',
          variant_name: 'Silver',
        },
      })
    );
  });

  it('submits whole-cart review requests with a cart snapshot and summary', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { email: 'buyer@example.com', id: 'customer-1' } },
    });
    const cartItems: CartItem[] = [
      createCartItem({
        brand: 'Apple',
        image_url: 'https://cdn.example/iphone.png',
        quantity: 1,
      }),
      createCartItem({
        id: 'line-2',
        name: 'Galaxy S24',
        price: 900000,
        product_id: 'product-2',
        quantity: 2,
        slug: 'galaxy-s24',
      }),
    ];
    const { result } = renderController({
      cartItems,
      currentPrice: 2100000,
      itemInfo: null,
      type: 'total',
    });

    act(() => {
      result.current.setOffer('₦1,950,000');
      result.current.setUploadLink(' https://proof.example/listing ');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockFrom).toHaveBeenCalledWith('negotiation_requests');
    expect(mockInsert).toHaveBeenCalledWith({
      cart_snapshot: [
        {
          brand: 'Apple',
          image: 'https://cdn.example/iphone.png',
          name: 'iPhone 15 Pro',
          price: 1200000,
          product_id: 'product-1',
          quantity: 1,
        },
        {
          name: 'Galaxy S24',
          price: 900000,
          product_id: 'product-2',
          quantity: 2,
        },
      ],
      customer_id: 'customer-1',
      customer_email: 'buyer@example.com',
      customer_phone: null,
      evidence_url: 'https://proof.example/listing',
      item_info: {
        current_price: 2100000,
        image: 'https://cdn.example/iphone.png',
        name: '3 items: iPhone 15 Pro, Galaxy S24',
      },
      merchant_id: 'merchant-1',
      offered_price: 1950000,
      session_id: 'session-123',
      status: 'pending',
      type: 'total',
    });
    expect(result.current.status).toBe('submitted');
    expect(result.current.message).toBe(
      "Request submitted! We'll notify you as soon as the merchant reviews your offer."
    );
  });

  it('persists a normalized customer_phone when one is entered', async () => {
    const { result } = renderController();

    act(() => {
      result.current.setOffer('₦90,000');
      result.current.setUploadLink('https://proof.example/listing');
      result.current.setPhone('0803 123 4567');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ customer_phone: '2348031234567' })
    );
  });

  it('allows a guest submission when Supabase reports a missing session', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    const { result } = renderController();

    act(() => {
      result.current.setOffer('₦90,000');
      result.current.setUploadLink('https://proof.example/listing');
      result.current.setPhone('0803 123 4567');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: null,
        customer_phone: '2348031234567',
      })
    );
  });

  it('blocks evidence upload when the authentication check fails unexpectedly', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('auth unavailable'),
    });
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      assets: [{ uri: 'file://proof.png' }],
      canceled: false,
    });
    const { result } = renderController();

    act(() => {
      result.current.setPhone('0803 123 4567');
    });
    await act(async () => {
      await result.current.pickImage();
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockUploadNegotiationEvidence).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.current.status).toBe('upload');
    expect(alertSpy).toHaveBeenCalledWith(
      'Upload failed',
      'Unable to upload evidence image. Please try again or use a link.'
    );
  });

  it('returns to upload state and alerts when the insert fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockInsert.mockResolvedValue({ error: new Error('permission denied') });
    const { result } = renderController();

    act(() => {
      result.current.setOffer('₦90,000');
      result.current.setUploadLink('https://proof.example/listing');
      result.current.setPhone('0803 123 4567');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('upload');
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      'Failed to submit request. Please try again.'
    );
    expect(result.current.message).not.toContain('Request submitted');
  });

  it('requires a phone number for guest review requests', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = renderController();

    act(() => {
      result.current.setOffer('₦90,000');
      result.current.setUploadLink('https://proof.example/listing');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.current.status).toBe('upload');
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      'Enter a Phone / WhatsApp number so the merchant can reach you about this offer.'
    );
  });

  it('requires direct contact when the signed-in account has no email or phone', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          email: undefined,
          id: 'customer-without-contact',
          phone: undefined,
        },
      },
      error: null,
    });
    const { result } = renderController();

    act(() => {
      result.current.setOffer('₦90,000');
      result.current.setUploadLink('https://proof.example/listing');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.current.status).toBe('upload');
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      'Enter a Phone / WhatsApp number so the merchant can reach you about this offer.'
    );
  });

  it('validates guest contact before uploading selected evidence', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      assets: [{ uri: 'file://proof.png' }],
      canceled: false,
    });
    const { result } = renderController();

    await act(async () => {
      await result.current.pickImage();
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockUploadNegotiationEvidence).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      'Enter a Phone / WhatsApp number so the merchant can reach you about this offer.'
    );
  });

  it('fails closed when a whole-cart request has no cart snapshot', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = renderController({
      cartItems: [],
      itemInfo: null,
      type: 'total',
    });

    act(() => {
      result.current.setOffer('₦90,000');
      result.current.setUploadLink('https://proof.example/listing');
      result.current.setPhone('0803 123 4567');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.current.status).toBe('upload');
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      'Whole-cart negotiations require at least one cart item.'
    );
  });

  it('rejects invalid phone input before inserting a merchant review request', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = renderController();

    act(() => {
      result.current.setOffer('₦90,000');
      result.current.setUploadLink('https://proof.example/listing');
      result.current.setPhone('not a phone');
    });
    await act(async () => {
      await result.current.handleUploadSubmit();
    });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.current.status).toBe('upload');
    expect(alertSpy).toHaveBeenCalledWith(
      'Error',
      'Enter a valid Phone / WhatsApp number.'
    );
  });

  it('prefills the phone field from a signed-in customer', () => {
    const { result } = renderController({ prefillPhone: '08029998888' });

    expect(result.current.phone).toBe('08029998888');
  });
});
