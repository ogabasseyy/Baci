import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { equityForPercentage, percentageForAmount } from './down-payment';
import { OxygenDownPayment } from './OxygenDownPayment';

function Control() {
  const [percentage, setPercentage] = useState<number | null>(30);
  return (
    <OxygenDownPayment
      productAmount={396000}
      percentage={percentage}
      onChange={setPercentage}
      extraPercentages={[37.25]}
    />
  );
}
it('syncs naira entry, percentage, slider and taps without submitting anything', () => {
  render(<Control />);
  const input = screen.getByLabelText('Your down payment');
  expect(input).toHaveValue('118,800');
  fireEvent.change(input, { target: { value: '147510' } });
  expect(screen.getByLabelText('Down payment percentage')).toHaveTextContent(
    '37.25%'
  );
  expect(screen.getByRole('slider')).toHaveValue('37.25');
  expect(screen.getByRole('button', { name: '37.25%' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.blur(input);
  expect(input).toHaveValue('147,510');
  fireEvent.click(screen.getByRole('button', { name: '50%' }));
  expect(input).toHaveValue('198,000');
  fireEvent.change(screen.getByRole('slider'), { target: { value: '35' } });
  expect(input).toHaveValue('138,600');
});
it('does not silently treat empty, malformed or out-of-range money as a valid plan', () => {
  const onChange = vi.fn();
  render(
    <OxygenDownPayment
      productAmount={396000}
      percentage={30}
      onChange={onChange}
    />
  );
  for (const value of ['', '1', '400000', '-100', '150000.001', 'hello']) {
    fireEvent.change(screen.getByLabelText('Your down payment'), {
      target: { value },
    });
    expect(onChange).toHaveBeenLastCalledWith(null);
  }
});
it('rounds to a supported percentage and announces the resulting money adjustment on blur', () => {
  render(<Control />);
  const input = screen.getByLabelText('Your down payment');
  fireEvent.change(input, { target: { value: '150000' } });
  fireEvent.blur(input);
  expect(input).toHaveValue('150,004.8');
  expect(screen.getByText(/Adjusted to/)).toHaveTextContent(
    'Adjusted to 37.88%'
  );
  expect(equityForPercentage(100.01, 50)).toBe(50.01);
  expect(percentageForAmount(396000, '99,000')).toBe(25);
  expect(percentageForAmount(396000, '356400')).toBe(90);
});

it('accepts the displayed rounded minimum and maximum for prices with kobo', () => {
  expect(percentageForAmount(100.01, '25')).toBe(25);
  expect(percentageForAmount(100.01, '90.01')).toBe(90);
});
