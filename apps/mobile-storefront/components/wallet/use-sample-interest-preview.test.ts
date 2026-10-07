import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { hostedStorefrontRuntime } from '@/lib/hosted-storefront-runtime';
import { useSampleInterestPreview } from './use-sample-interest-preview';

jest.mock('@/lib/hosted-storefront-runtime', () => ({
  hostedStorefrontRuntime: {
    read: jest.fn(() => ({ environment: 'hosted-staging' })),
  },
}));

describe('useSampleInterestPreview', () => {
  beforeEach(() => {
    jest.mocked(hostedStorefrontRuntime.read).mockReturnValue({} as never);
  });

  it('starts closed, opens explicitly, reopens after close, and closes on owner change', () => {
    const goal = {
      current_amount: 1250,
      status: 'active' as const,
      title: 'Phone savings',
    };
    const { result, rerender } = renderHook(
      ({ ownerId }: { ownerId: string }) =>
        useSampleInterestPreview(ownerId, goal),
      { initialProps: { ownerId: 'owner-a' } }
    );

    expect(result.current.visible).toBe(false);
    act(() => result.current.open());
    expect(result.current.visible).toBe(true);
    act(() => result.current.close());
    expect(result.current.visible).toBe(false);
    act(() => result.current.open());
    expect(result.current.visible).toBe(true);

    rerender({ ownerId: 'owner-b' });
    expect(result.current.visible).toBe(false);
  });

  it('fails closed when hosted runtime verification throws', () => {
    jest.mocked(hostedStorefrontRuntime.read).mockImplementation(() => {
      throw new Error('runtime not verified');
    });
    const { result } = renderHook(() =>
      useSampleInterestPreview('owner-a', {
        current_amount: 1250,
        status: 'active',
        title: 'Phone savings',
      })
    );

    expect(result.current.available).toBe(false);
    expect(result.current.visible).toBe(false);
  });

  it('fails closed when hosted runtime read returns no verified runtime', () => {
    jest.mocked(hostedStorefrontRuntime.read).mockReturnValue(null);
    const { result } = renderHook(() =>
      useSampleInterestPreview('owner-a', {
        current_amount: 1250,
        status: 'active',
        title: 'Phone savings',
      })
    );

    expect(result.current.available).toBe(false);
  });
});
