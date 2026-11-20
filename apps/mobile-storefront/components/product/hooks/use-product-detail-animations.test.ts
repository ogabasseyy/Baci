import { act, renderHook } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import Colors from '@/constants/Colors';
import { useProductDetailAnimations } from './use-product-detail-animations';

it('resizes the header in the mounted product detail as the window changes', () => {
  const original = Dimensions.get('window');
  try {
    Dimensions.set({ window: { ...original, width: 390, height: 740 } });
    const { result } = renderHook(() =>
      useProductDetailAnimations(Colors.light)
    );
    expect(result.current.headerHeight).toBe(390);

    act(() => {
      Dimensions.set({ window: { ...original, width: 800, height: 360 } });
    });
    expect(result.current.headerHeight).toBe(360);
  } finally {
    act(() => Dimensions.set({ window: original }));
  }
});
