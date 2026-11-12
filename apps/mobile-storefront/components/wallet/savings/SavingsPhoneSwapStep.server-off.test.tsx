import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { Product } from '@/types/product';
import { SavingsPhoneSwapStep } from './SavingsPhoneSwapStep';

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

const iphone: Product = {
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
};

const goal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 120000,
  id: 'goal-1',
  maturity_date: '2999-01-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Sandbox Test Phone',
} satisfies WalletActiveSavingsGoal;

function renderStep(
  over: Partial<Parameters<typeof SavingsPhoneSwapStep>[0]['swap']> = {},
  savedGoal: WalletActiveSavingsGoal = goal
) {
  const swap = {
    handleSelectSavingsDevice: jest.fn(async () => undefined),
    isChangingSavingsDevice: false,
    isSavingsDeviceLoading: false,
    resolveProduct: jest.fn(async (product: Product) => product),
    savingsDeviceProducts: [iphone],
    savingsDeviceSearch: 'iphone',
    setSavingsDeviceSearch: jest.fn(),
    setShowSavingsDeviceSwap: jest.fn(),
    ...over,
  };
  const view = render(
    <SavingsPhoneSwapStep colors={Colors.light} goal={savedGoal} swap={swap} />
  );
  return { swap, view };
}

describe('Change phone inside the savings sheet, server off', () => {
  it('shows the phone saved for now and each choice with what is left to save', () => {
    renderStep();
    expect(screen.getByRole('header', { name: 'Change phone' })).toBeTruthy();
    expect(
      screen.getByText('Sandbox Test Phone · ₦120,000 saved')
    ).toBeOnTheScreen();
    expect(screen.getByText('Used · Storage: 256GB')).toBeOnTheScreen();
    expect(screen.getByText('₦530,000 to go')).toBeOnTheScreen();
  });

  it('hides phones cheaper than the saved amount behind one quiet line', () => {
    renderStep();
    expect(
      screen.queryByRole('button', {
        name: 'Choose iPhone 15 Pro Storage: 128GB',
      })
    ).toBeNull();
    expect(
      screen.getByText(
        "Phones under ₦120,000 are hidden. You've already saved more."
      )
    ).toBeOnTheScreen();
  });

  it('a tap only previews the switch; Switch phone sends it once', async () => {
    const { swap } = renderStep();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Choose iPhone 15 Pro Storage: 256GB',
      })
    );
    expect(swap.handleSelectSavingsDevice).not.toHaveBeenCalled();
    expect(screen.getByText('Switch to iPhone 15 Pro?')).toBeOnTheScreen();
    expect(screen.getByText('₦650,000')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Switch phone' }));
    });
    expect(swap.handleSelectSavingsDevice).toHaveBeenCalledTimes(1);
    expect(swap.handleSelectSavingsDevice).toHaveBeenCalledWith(
      iphone,
      'variant-256'
    );
  });

  it('Keep goes back to the list without sending anything', () => {
    const { swap } = renderStep();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Choose iPhone 15 Pro Storage: 256GB',
      })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Keep Sandbox Test Phone' })
    );
    expect(screen.getByRole('header', { name: 'Change phone' })).toBeTruthy();
    expect(swap.handleSelectSavingsDevice).not.toHaveBeenCalled();
  });

  it('locks the confirm while the switch is being saved', () => {
    const { swap, view } = renderStep();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Choose iPhone 15 Pro Storage: 256GB',
      })
    );
    view.rerender(
      <SavingsPhoneSwapStep
        colors={Colors.light}
        goal={goal}
        swap={{ ...swap, isChangingSavingsDevice: true }}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Switch phone' })
    ).toHaveAccessibilityState({ disabled: true, busy: true });
  });

  it('Back returns to the savings view', () => {
    const { swap } = renderStep();
    fireEvent.press(screen.getByRole('button', { name: 'Back to savings' }));
    expect(swap.setShowSavingsDeviceSwap).toHaveBeenCalledWith(false);
  });

  it('shows loading and empty states', () => {
    const { view, swap } = renderStep({ isSavingsDeviceLoading: true });
    expect(screen.getByLabelText('Loading phones')).toBeOnTheScreen();
    view.rerender(
      <SavingsPhoneSwapStep
        colors={Colors.light}
        goal={goal}
        swap={{
          ...swap,
          isSavingsDeviceLoading: false,
          savingsDeviceProducts: [],
        }}
      />
    );
    expect(screen.getByText('No matching phones.')).toBeOnTheScreen();
  });

  it('never autoplays phone images', () => {
    renderStep();
    expect(
      screen.getAllByRole('image', { name: 'iPhone 15 Pro' })[0]?.props.autoplay
    ).toBe(false);
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
