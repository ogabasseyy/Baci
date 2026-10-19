import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import { SavingsCardMethodPicker } from './SavingsCardMethodPicker';

type Props = ComponentProps<typeof SavingsCardMethodPicker>;
const snapshot: Props['snapshot'] = {
  goalId: 'goal-1',
  savedMethodId: 'method-1',
  amountKobo: 25050,
  idempotencyKey: 'key-1',
  consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
};

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    loading: false,
    capabilityLoaded: true,
    enabled: true,
    snapshot: null,
    methods: [
      { id: 'method-1', brand: 'Visa', last4: '4242' },
      { id: 'method-2', brand: 'Mastercard', last4: '1234' },
    ],
    canStart: true,
    selectedMethodId: 'method-1',
    onSelectMethod: jest.fn<(id: string) => void>(),
    colors: Colors.light,
    ...overrides,
  };
  render(<SavingsCardMethodPicker {...props} />);
  return props;
}

it('displays saved cards, identifies the selected card, and selects the exact method', () => {
  const props = setup();
  expect(screen.getByRole('radio', { name: /Visa.*4242/ })).toBeChecked();
  const second = screen.getByRole('radio', { name: /Mastercard.*1234/ });
  expect(second).not.toBeChecked();
  fireEvent.press(second);
  expect(props.onSelectMethod).toHaveBeenCalledWith('method-2');
});

it.each([
  { canStart: false },
  { snapshot },
])('prevents card selection when starting is blocked: %j', (overrides) => {
  const props = setup(overrides);
  const card = screen.getByRole('radio', { name: /Visa.*4242/ });
  expect(card).toBeDisabled();
  fireEvent.press(card);
  expect(props.onSelectMethod).not.toHaveBeenCalled();
});

it('shows the loading state without capability or empty-card notices', () => {
  setup({
    loading: true,
    capabilityLoaded: false,
    methods: [],
    enabled: false,
  });
  expect(screen.getByText('Loading saved cards…')).toBeOnTheScreen();
  expect(screen.queryByText(/unavailable right now/)).toBeNull();
  expect(screen.queryByText(/No saved cards/)).toBeNull();
});

it.each([
  { capabilityLoaded: false },
  { enabled: false },
])('shows unavailable capability without permitting new card setup: %j', (overrides) => {
  setup({ ...overrides, enabled: false });
  expect(
    screen.getByText('Card contributions are unavailable right now.')
  ).toBeOnTheScreen();
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
});

it('shows the empty-card notice only before a durable request exists', () => {
  const { rerender } = render(
    <SavingsCardMethodPicker
      loading={false}
      capabilityLoaded
      enabled
      canStart
      methods={[]}
      selectedMethodId=""
      onSelectMethod={jest.fn()}
      colors={Colors.light}
      snapshot={null}
    />
  );
  expect(screen.getByText(/No saved cards are available/)).toBeOnTheScreen();
  rerender(
    <SavingsCardMethodPicker
      loading={false}
      capabilityLoaded
      enabled
      canStart
      methods={[]}
      selectedMethodId=""
      onSelectMethod={jest.fn()}
      colors={Colors.light}
      snapshot={snapshot}
    />
  );
  expect(screen.queryByText(/No saved cards are available/)).toBeNull();
});
