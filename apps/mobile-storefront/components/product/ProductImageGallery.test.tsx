import { jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { ProductImageGalleryProps } from './ProductImageGallery';

const mockImage = jest.fn();

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ fontScale: 1, height: 800, scale: 2, width: 400 }),
}));

jest.mock('expo-image', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Image: (props: Record<string, unknown>) => {
      mockImage(props);
      return React.createElement('Image', props);
    },
  };
});

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

jest.mock('./ImageZoomModal', () => ({
  ImageZoomModal: () => null,
}));

import { ProductImageGallery } from './ProductImageGallery';

const IMAGES = [
  'https://cdn.ogabassey.com/core-assets/products/phone.avif',
  'https://cdn.ogabassey.com/core-assets/products/phone-side.avif',
];

function renderGallery(overrides: Partial<ProductImageGalleryProps> = {}) {
  return render(
    <ProductImageGallery
      colors={Colors.light}
      discountPercentage={null}
      headerHeight={300}
      imageAnimatedStyle={{}}
      images={IMAGES}
      selectedImageIndex={1}
      setSelectedImageIndex={jest.fn()}
      setShowImageZoom={jest.fn()}
      showImageZoom={false}
      {...overrides}
    />
  );
}

describe('ProductImageGallery image bounds', () => {
  it('uses bounded cover transforms for the selected image and thumbnails', () => {
    renderGallery();

    expect(mockImage).toHaveBeenCalledTimes(3);
    expect(mockImage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        source: {
          height: 600,
          uri: 'https://cdn.ogabassey.com/image/width=800,height=600,quality=82,format=webp,fit=cover/core-assets/products/phone-side.avif',
          width: 800,
        },
      })
    );
    expect(
      mockImage.mock.calls
        .slice(1)
        .map(([props]) => (props as { source: unknown }).source)
    ).toEqual([
      {
        height: 128,
        uri: 'https://cdn.ogabassey.com/image/width=128,height=128,quality=82,format=webp,fit=cover/core-assets/products/phone.avif',
        width: 128,
      },
      {
        height: 128,
        uri: 'https://cdn.ogabassey.com/image/width=128,height=128,quality=82,format=webp,fit=cover/core-assets/products/phone-side.avif',
        width: 128,
      },
    ]);
  });
});
