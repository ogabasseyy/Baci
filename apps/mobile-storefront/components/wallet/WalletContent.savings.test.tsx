import { expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Text } from 'react-native';
import { WalletContent } from './WalletContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { View },
    FadeIn: {
      duration: () => ({
        delay: () => ({}),
      }),
    },
  };
});

jest.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({
    isLoading: false,
    products: [
      {
        condition: 'Used',
        id: 'product-swap',
        image: 'https://cdn.example.com/swap.jpg',
        name: 'iPhone 16 Pro',
        price: 150000,
        slug: 'iphone-16-pro',
      },
    ],
  }),
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

it('passes the exact resolver to completed savings recovery and closes on success', async () => {
  const props = createWalletContentProps();
  const goal = {
    ...props.activeSavingsGoal,
    status: 'completed' as const,
    selection_unresolved: true,
    variant_resolution_options: [{ id: 'variant-1', label: '256GB' }],
  };
  render(
    <WalletContent {...props} activeSavingsGoal={goal} showSavingsProgress />
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Resolve savings device variant' })
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Resolve savings variant 256GB' })
  );
  await waitFor(() =>
    expect(props.onResolveSavingsVariant).toHaveBeenCalledWith('variant-1')
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Resolve savings variant 256GB' })
    ).toBeNull()
  );
});

it('renders savings progress modal and wires manual contribution actions', async () => {
  const props = createWalletContentProps();
  render(
    <WalletContent
      {...props}
      savingsContributionAmount="500"
      spendableBalance={1000}
      showSavingsProgress
    />
  );

  expect(screen.getAllByText('Add to savings').length).toBeGreaterThan(0);
  expect(screen.getByText('50%')).toBeOnTheScreen();
  expect(screen.getByText('Condition: Used')).toBeOnTheScreen();
  expect(screen.getAllByText('Storage: 256GB')).toHaveLength(2);

  fireEvent.changeText(screen.getByLabelText('Savings top-up amount'), '500');
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm savings top-up' })
  );
  expect(
    screen.queryByRole('button', {
      name: 'Continue to payment',
    })
  ).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Change savings device' })
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Select iPhone 16 Pro' })
    );
    await Promise.resolve();
  });

  expect(props.onChangeSavingsContributionAmount).toHaveBeenCalledWith('500');
  expect(props.onAddSavingsContribution).toHaveBeenCalledTimes(1);
  expect(props.onFundSavingsWallet).not.toHaveBeenCalled();
  expect(props.onChangeSavingsDevice).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'product-swap' }),
    null
  );
});

it('requires an amount before opening wallet payment for an empty spendable wallet', () => {
  const props = createWalletContentProps();
  const { rerender } = render(<WalletContent {...props} showSavingsProgress />);

  expect(screen.getByText('Available in wallet: ₦0')).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Confirm savings top-up' })
  ).toBeNull();
  const paymentAction = screen.getByRole('button', {
    name: 'Continue to payment',
  });
  expect(paymentAction).toHaveAccessibilityState({ disabled: true });
  fireEvent.press(paymentAction);
  expect(props.onFundSavingsWallet).not.toHaveBeenCalled();

  rerender(
    <WalletContent
      {...props}
      savingsContributionAmount="500"
      showSavingsProgress
    />
  );
  fireEvent.press(
    screen.getByRole('button', {
      name: 'Continue to payment',
    })
  );
  expect(props.onFundSavingsWallet).toHaveBeenCalledTimes(1);
  expect(props.onAddSavingsContribution).not.toHaveBeenCalled();
});

it('shows the active plan progress on the wallet before opening its detail sheet', () => {
  const props = createWalletContentProps();
  render(<WalletContent {...props} />);

  expect(
    screen.getByRole('progressbar', { name: 'Savings plan progress' })
  ).toHaveAccessibilityValue({ now: 50 });
  fireEvent.press(
    screen.getByRole('button', { name: 'Add to savings for iPhone 15 Pro' })
  );
  expect(props.onStartSavings).toHaveBeenCalledTimes(1);
});

it('places the real funding account beside the balance before the device plan', () => {
  const props = createWalletContentProps();
  const { UNSAFE_root } = render(<WalletContent {...props} />);
  const rendered = UNSAFE_root.findAllByType(Text)
    .map((element) => String(element.props.children))
    .join('|');

  expect(rendered.indexOf('Total Balance · NGN')).toBeLessThan(
    rendered.indexOf('iPhone 15 Pro')
  );
  expect(rendered.indexOf('1234567890')).toBeLessThan(
    rendered.indexOf('iPhone 15 Pro')
  );
  expect(rendered).toContain('1234567890');
});
