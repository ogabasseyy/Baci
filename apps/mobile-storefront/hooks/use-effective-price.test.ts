import { renderHook } from '@testing-library/react-native';
import type { Product } from '@/types/product';
import { useEffectivePrice } from './use-effective-price';

const baseProduct: Product = {
  id: 'product-1',
  merchant_id: 'merchant-1',
  name: 'iPhone 13 Pro',
  slug: 'iphone-13-pro',
  price: 552000,
  compare_at_price: 600000,
  image: 'https://cdn.example.com/iphone-13-pro.jpg',
  offers: [
    {
      id: 'offer-refurbished',
      condition: 'refurbished',
      price: 510000,
      compare_at_price: 560000,
      stock_quantity: 2,
    },
    {
      id: 'offer-uk-used',
      condition: 'uk_used',
      price: 495000,
      compare_at_price: 540000,
      stock_quantity: 1,
    },
  ],
};

describe('useEffectivePrice', () => {
  it('uses a legacy refurbished offer for canonical open_box selections', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(baseProduct, null, 'open_box', null)
    );

    expect(result.current).toEqual({
      price: 510000,
      comparePrice: 560000,
    });
  });

  it('uses a legacy uk_used offer for canonical used selections', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(baseProduct, null, 'used', null)
    );

    expect(result.current).toEqual({
      price: 495000,
      comparePrice: 540000,
    });
  });

  it('uses legacy alias selections when the selected condition is not yet canonicalized', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(baseProduct, null, 'refurbished', null)
    );

    expect(result.current).toEqual({
      price: 510000,
      comparePrice: 560000,
    });
  });

  it('uses an exact raw legacy offer condition when canonical normalization is unavailable', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(
        {
          ...baseProduct,
          offers: [
            {
              id: 'offer-scratch-and-dent',
              condition: 'scratch_and_dent' as never,
              price: 470000,
              compare_at_price: 520000,
              stock_quantity: 2,
            },
          ],
        },
        null,
        'scratch_and_dent',
        null
      )
    );

    expect(result.current).toEqual({
      price: 470000,
      comparePrice: 520000,
    });
  });

  it('falls back to a single raw legacy offer when no condition is selected', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(
        {
          ...baseProduct,
          offers: [
            {
              id: 'offer-scratch-and-dent',
              condition: 'scratch_and_dent' as never,
              price: 470000,
              compare_at_price: 520000,
              stock_quantity: 2,
            },
          ],
        },
        null,
        null,
        null
      )
    );

    expect(result.current).toEqual({
      price: 470000,
      comparePrice: 520000,
    });
  });

  it('prefers an exact open_box offer over a canonical refurbished alias', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(
        {
          ...baseProduct,
          offers: [
            {
              id: 'offer-refurbished',
              condition: 'refurbished',
              price: 510000,
              compare_at_price: 560000,
              stock_quantity: 2,
            },
            {
              id: 'offer-open-box',
              condition: 'open_box',
              price: 525000,
              compare_at_price: 575000,
              stock_quantity: 3,
            },
          ],
        },
        null,
        'open_box',
        null
      )
    );

    expect(result.current).toEqual({
      price: 525000,
      comparePrice: 575000,
    });
  });

  it('uses a negotiated price of 0 instead of the calculated price', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(baseProduct, null, 'open_box', 0)
    );

    expect(result.current).toEqual({
      price: 0,
      comparePrice: 560000,
    });
  });

  it('uses a positive negotiated price instead of the calculated price', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(baseProduct, null, 'open_box', 123456)
    );

    expect(result.current).toEqual({
      price: 123456,
      comparePrice: 560000,
    });
  });

  it('keeps the base price for suppressed base-row entries', () => {
    const { result } = renderHook(() =>
      useEffectivePrice(baseProduct, null, 'used', null, null, true)
    );

    expect(result.current).toEqual({
      price: 552000,
      comparePrice: 600000,
    });
  });
});
