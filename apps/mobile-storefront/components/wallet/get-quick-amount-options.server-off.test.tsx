import { getQuickAmountOptions } from './get-quick-amount-options';

it('offers fitting fixed amounts plus an all-available option', () => {
  expect(getQuickAmountOptions({ available: 1000, remaining: 6000 })).toEqual([
    { amount: 5000, label: '₦5k' },
    { amount: 1000, label: 'Max', spokenLabel: 'all available' },
  ]);
});

it('offers only the needed remainder when funds exceed the goal', () => {
  expect(getQuickAmountOptions({ available: 90000, remaining: 7000 })).toEqual([
    { amount: 1000, label: '₦1k' },
    { amount: 5000, label: '₦5k' },
    { amount: 7000, label: 'Finish', spokenLabel: 'reach goal' },
  ]);
});

it('does not claim the floored option reaches a fractional remainder', () => {
  expect(getQuickAmountOptions({ available: 9000, remaining: 7000.5 })).toEqual(
    [
      { amount: 1000, label: '₦1k' },
      { amount: 5000, label: '₦5k' },
      { amount: 7000, label: '₦7,000' },
    ]
  );
});

it('offers only whole available funds when they are below a fixed amount', () => {
  expect(getQuickAmountOptions({ available: 400, remaining: 800 })).toEqual([
    { amount: 400, label: 'Max', spokenLabel: 'all available' },
  ]);
});

it('shows no quick picks when the goal is already funded', () => {
  expect(getQuickAmountOptions({ available: 5000, remaining: 0 })).toEqual([]);
});

it('never offers an amount greater than what is left to save', () => {
  const options = getQuickAmountOptions({ available: 1000, remaining: 6000 });
  expect(options.every(({ amount }) => amount <= 6000)).toBe(true);
});

it('labels the exact goal remainder when fractional funds are left over', () => {
  expect(
    getQuickAmountOptions({ available: 7000.5, remaining: 7000 }).at(-1)
  ).toEqual({ amount: 7000, label: 'Finish', spokenLabel: 'reach goal' });
});
