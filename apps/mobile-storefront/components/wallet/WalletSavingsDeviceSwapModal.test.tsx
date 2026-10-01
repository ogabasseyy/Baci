import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import { WalletSavingsDeviceSwapModal } from './WalletSavingsDeviceSwapModal';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: ({
      autoplay,
      accessibilityLabel,
    }: {
      autoplay?: boolean;
      accessibilityLabel?: string;
    }) => {
      const viewProps = {
        autoplay,
        accessible: true,
        accessibilityRole: 'image',
        accessibilityLabel,
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
});

const products: Product[] = [
  {
    condition: 'Used',
    id: 'product-1',
    image: 'https://cdn.example.com/iphone.jpg',
    name: 'iPhone 15 Pro',
    price: 700000,
    slug: 'iphone-15-pro',
    variants: [
      {
        attributes: { storage: '256GB' },
        condition: 'used' as const,
        id: 'variant-256',
        image: 'https://cdn.example.com/iphone-256.jpg',
        name: '256GB',
        price: 650000,
      },
      {
        attributes: { storage: '128GB' },
        condition: 'used' as const,
        id: 'variant-128',
        image: 'https://cdn.example.com/iphone-128.jpg',
        name: '128GB',
        price: 100000,
      },
    ],
  },
];

type WalletSavingsDeviceSwapModalProps = ComponentProps<
  typeof WalletSavingsDeviceSwapModal
>;

function renderSwapModal(
  overrides: Partial<WalletSavingsDeviceSwapModalProps> = {}
) {
  return render(
    <WalletSavingsDeviceSwapModal
      colors={Colors.light}
      currentAmount={120000}
      isLoading={false}
      isPending={false}
      onClose={jest.fn()}
      onSearchChange={jest.fn()}
      onSelectDevice={jest.fn()}
      products={products}
      searchValue="iphone"
      visible
      {...overrides}
    />
  );
}

describe('WalletSavingsDeviceSwapModal', () => {
  it('renders variant choices and selects an affordable replacement device', () => {
    const onSearchChange = jest.fn();
    const onSelectDevice = jest.fn();

    renderSwapModal({ onSearchChange, onSelectDevice });

    expect(screen.getByText('Change savings device')).toBeOnTheScreen();
    expect(screen.getByText('Already saved: ₦120,000')).toBeOnTheScreen();
    expect(screen.getByText('Used · Storage: 256GB')).toBeOnTheScreen();
    expect(screen.getByText('Used · Storage: 128GB')).toBeOnTheScreen();
    expect(
      screen.getByText('Choose a device priced at or above your saved amount.')
    ).toBeOnTheScreen();

    fireEvent.changeText(
      screen.getByRole('search', { name: 'Savings replacement device search' }),
      'iphone 15'
    );
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Select iPhone 15 Pro Storage: 256GB',
      })
    );

    expect(onSearchChange).toHaveBeenCalledWith('iphone 15');
    expect(onSelectDevice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'product-1' }),
      'variant-256'
    );
    expect(
      screen.getByRole('button', {
        name: 'Select iPhone 15 Pro Storage: 128GB',
      })
    ).toHaveAccessibilityState({ disabled: true });
  });

  describe('bugfix: animated wallet product images', () => {
    it('does not autoplay replacement device images', () => {
      renderSwapModal();

      expect(
        screen.getAllByRole('image', { name: 'iPhone 15 Pro' })[0]?.props
          .autoplay
      ).toBe(false);
    });
  });

  it('shows loading and empty states', () => {
    const { rerender } = renderSwapModal({ isLoading: true });

    expect(screen.getByText('Loading devices...')).toBeOnTheScreen();

    rerender(
      <WalletSavingsDeviceSwapModal
        colors={Colors.light}
        currentAmount={120000}
        isLoading={false}
        isPending={false}
        onClose={jest.fn()}
        onSearchChange={jest.fn()}
        onSelectDevice={jest.fn()}
        products={[]}
        searchValue="pixel"
        visible
      />
    );

    expect(screen.getByText('No matching devices found.')).toBeOnTheScreen();
  });

  it('disables choices while pending or below the saved amount', () => {
    const { rerender } = renderSwapModal({ isPending: true });

    expect(
      screen.getByRole('button', {
        name: 'Select iPhone 15 Pro Storage: 256GB',
      })
    ).toHaveAccessibilityState({ disabled: true, busy: true });
    expect(
      screen.getByRole('button', {
        name: 'Select iPhone 15 Pro Storage: 128GB',
      })
    ).toHaveAccessibilityState({ disabled: true, busy: true });

    rerender(
      <WalletSavingsDeviceSwapModal
        colors={Colors.light}
        currentAmount={800000}
        isLoading={false}
        isPending={false}
        onClose={jest.fn()}
        onSearchChange={jest.fn()}
        onSelectDevice={jest.fn()}
        products={products}
        searchValue="iphone"
        visible
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'Select iPhone 15 Pro Storage: 256GB',
      })
    ).toHaveAccessibilityState({ disabled: true });
    expect(
      screen.getByRole('button', {
        name: 'Select iPhone 15 Pro Storage: 128GB',
      })
    ).toHaveAccessibilityState({ disabled: true });
    expect(
      screen.getAllByText(
        'Choose a device priced at or above your saved amount.'
      )
    ).toHaveLength(2);
  });

  it('does not render modal content when hidden', () => {
    renderSwapModal({ visible: false });

    expect(screen.queryByText('Change savings device')).toBeNull();
  });
});
