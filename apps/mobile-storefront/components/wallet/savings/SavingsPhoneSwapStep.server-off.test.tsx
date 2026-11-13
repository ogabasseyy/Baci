import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { Product } from '@/types/product';
import { SavingsSheetLockContext } from '../SavingsSheetLockContext';
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

  it('keeps the savings sheet open while the switch is being saved', () => {
    const { swap } = renderStep();
    const setLocked = jest.fn();
    render(
      <SavingsSheetLockContext.Provider value={setLocked}>
        <SavingsPhoneSwapStep
          colors={Colors.light}
          goal={goal}
          swap={{ ...swap, isChangingSavingsDevice: true }}
        />
      </SavingsSheetLockContext.Provider>
    );
    expect(setLocked).toHaveBeenLastCalledWith(true);
  });

  it('drops a picked phone when the goal changes', () => {
    const { swap, view } = renderStep();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Choose iPhone 15 Pro Storage: 256GB',
      })
    );
    expect(screen.getByRole('button', { name: 'Switch phone' })).toBeTruthy();
    view.rerender(
      <SavingsPhoneSwapStep
        colors={Colors.light}
        goal={{ ...goal, id: 'goal-2' }}
        swap={swap}
      />
    );
    expect(screen.queryByRole('button', { name: 'Switch phone' })).toBeNull();
    expect(screen.getByRole('header', { name: 'Change phone' })).toBeTruthy();
  });

  it('does not offer the phone already being saved for', () => {
    renderStep({}, { ...goal, title: 'iPhone 15 Pro', target_amount: 650000 });
    expect(
      screen.queryByRole('button', {
        name: 'Choose iPhone 15 Pro Storage: 256GB',
      })
    ).toBeNull();
  });

  it('hides only the exact variant being saved for, not others at the same price', () => {
    const twins: Product = {
      ...iphone,
      variants: [
        {
          attributes: { storage: '128GB' },
          condition: 'used' as const,
          id: 'v-a',
          name: '128GB',
          price: 650000,
        },
        {
          attributes: { storage: '256GB' },
          condition: 'used' as const,
          id: 'v-b',
          name: '256GB',
          price: 650000,
        },
      ],
    };
    renderStep(
      { savingsDeviceProducts: [twins] },
      {
        ...goal,
        product_id: 'product-1',
        variant_id: 'v-a',
        target_amount: 650000,
      }
    );
    expect(
      screen.queryByRole('button', {
        name: 'Choose iPhone 15 Pro Storage: 128GB',
      })
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Choose iPhone 15 Pro Storage: 256GB',
      })
    ).toBeOnTheScreen();
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
});
