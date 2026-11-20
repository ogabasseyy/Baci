import { act, renderHook } from '@testing-library/react-native';
import { Dimensions, Platform } from 'react-native';
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

it('keeps the Android gallery stable when the keyboard reduces window height', () => {
  const original = Dimensions.get('window');
  const originalScreen = Dimensions.get('screen');
  const landscapeScreen = { ...originalScreen, width: 800, height: 390 };
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    Dimensions.set({
      screen: landscapeScreen,
      window: { ...original, width: 800, height: 360 },
    });
    const { result } = renderHook(() =>
      useProductDetailAnimations(Colors.light)
    );
    expect(result.current.headerHeight).toBe(390);

    act(() => {
      Dimensions.set({
        screen: landscapeScreen,
        window: { ...original, width: 800, height: 180 },
      });
    });
    expect(result.current.headerHeight).toBe(390);

    act(() => {
      Dimensions.set({
        screen: { ...originalScreen, width: 600, height: 480 },
        window: { ...original, width: 600, height: 450 },
      });
    });
    expect(result.current.headerHeight).toBe(480);
  } finally {
    act(() => Dimensions.set({ window: original, screen: originalScreen }));
    platform.restore();
  }
});
