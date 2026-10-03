import { describe, expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useProductCardImage } from './use-product-card-image';

const product = {
  id: 'p1',
  image: 'https://example.com/a.png',
  images: ['https://example.com/b.png'],
};

describe('useProductCardImage', () => {
  it('walks candidates on error before showing the placeholder', () => {
    const { result } = renderHook(() =>
      useProductCardImage(product, 'blurhash')
    );
    expect(result.current.imageAttemptUri).toBe('https://example.com/a.png');
    expect(result.current.showLocalPlaceholder).toBe(false);
    act(() => {
      result.current.imageProps.onError();
    });
    expect(result.current.imageAttemptUri).toBe('https://example.com/b.png');
    act(() => {
      result.current.imageProps.onError();
    });
    act(() => {
      result.current.imageProps.onError();
    });
    expect(result.current.showLocalPlaceholder).toBe(true);
  });
  it('resets the attempt when the image set changes', () => {
    const { result, rerender } = renderHook(
      ({ image }: { image: string }) =>
        useProductCardImage({ ...product, image }, 'blurhash'),
      { initialProps: { image: 'https://example.com/a.png' } }
    );
    act(() => {
      result.current.imageProps.onError();
    });
    expect(result.current.imageAttemptUri).toBe('https://example.com/b.png');
    rerender({ image: 'https://example.com/c.png' });
    expect(result.current.imageAttemptUri).toBe('https://example.com/c.png');
    expect(result.current.showLocalPlaceholder).toBe(false);
  });
});
