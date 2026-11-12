import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPhoneSwapStep } from './SavingsPhoneSwapStep';
import { goal, iphone, renderStep } from './savings-phone-swap.test-support';

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
    }) => (
      <View
        {...({
          autoplay,
          accessible: true,
          accessibilityRole: 'image',
          accessibilityLabel,
        } as object)}
      />
    ),
  };
});

describe('Change phone search previews, server off', () => {
  it('forgets an opened preview when the search changes, even if it comes back', async () => {
    const preview = { ...iphone, price: 1, variants: [], searchPreview: true };
    const { swap, view } = renderStep({
      resolveProduct: jest.fn(async () => iphone),
      savingsDeviceProducts: [preview],
    });
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose iPhone 15 Pro' })
    );
    await screen.findByRole('button', { name: /Choose iPhone 15 Pro.*256GB/ });
    const galaxy = {
      ...iphone,
      id: 'p2',
      name: 'Galaxy S23',
      variants: [],
      price: 610000,
    };
    for (const searchValue of ['galaxy', 'iphone']) {
      view.rerender(
        <SavingsPhoneSwapStep
          colors={Colors.light}
          goal={goal}
          swap={{
            ...swap,
            savingsDeviceSearch: searchValue,
            savingsDeviceProducts: [galaxy],
          }}
        />
      );
    }
    expect(
      screen.getByRole('button', { name: 'Choose Galaxy S23' })
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /256GB/ })).toBeNull();
  });

  it('loads a search preview before offering its exact options, never its preview price', async () => {
    const resolveProduct = jest.fn(async () => iphone);
    const { swap } = renderStep({
      resolveProduct,
      savingsDeviceProducts: [
        { ...iphone, price: 1, variants: [], searchPreview: true },
      ],
    });
    expect(screen.queryByText('₦1')).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose iPhone 15 Pro' })
    );
    expect(swap.handleSelectSavingsDevice).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: /Choose iPhone 15 Pro.*256GB/ });
    fireEvent.press(
      screen.getByRole('button', { name: /Choose iPhone 15 Pro.*256GB/ })
    );
    expect(screen.getByText('Switch to iPhone 15 Pro?')).toBeOnTheScreen();
  });

  it('says so when a preview cannot be loaded', async () => {
    renderStep({
      resolveProduct: jest.fn(async () => {
        throw new Error('offline');
      }),
      savingsDeviceProducts: [{ ...iphone, variants: [], searchPreview: true }],
    });
    fireEvent.press(
      screen.getByRole('button', { name: 'Choose iPhone 15 Pro' })
    );
    expect(
      await screen.findByText(
        "Couldn't load this phone's options. Please try again."
      )
    ).toBeOnTheScreen();
  });
});
