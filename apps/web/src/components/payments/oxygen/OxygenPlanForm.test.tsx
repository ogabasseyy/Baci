import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenPlanForm } from './OxygenPlanForm';

it('defaults to an available tenure when Oxygen allows fewer than three months', () => {
  const submit = vi.fn().mockResolvedValue(true);
  render(<OxygenPlanForm busy={false} maxTenure={1} submit={submit} />);
  expect(screen.getByRole('radio', { name: '1 month' })).toBeChecked();
  expect(
    screen.queryByRole('radio', { name: '3 months' })
  ).not.toBeInTheDocument();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).toHaveBeenCalledWith({
    action: 'book',
    equityPercentage: 25,
    tenure: 1,
  });
});
it('shows loading feedback and blocks another plan submission while busy', () => {
  const submit = vi.fn();
  render(<OxygenPlanForm busy submit={submit} />);
  expect(
    screen.getByRole('button', { name: 'Preparing your plan…' })
  ).toBeDisabled();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).not.toHaveBeenCalled();
});

it('updates a live breakdown without booking when choices change', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm
      busy={false}
      maxTenure={6}
      productAmount={396000}
      submit={submit}
    />
  );
  const preview = within(
    screen.getByRole('region', { name: 'Payment plan preview' })
  );
  expect(preview.getByText('₦99,000.00')).toBeInTheDocument();
  expect(preview.getByText('₦297,000.00')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '50%' }));
  expect(screen.getByLabelText('Your down payment')).toHaveValue('198,000');
  expect(preview.getAllByText('₦198,000.00')).toHaveLength(2);
  fireEvent.click(screen.getByRole('radio', { name: '6 months' }));
  expect(preview.getByText('6 months')).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
  expect(
    preview.getByText(/Interest, fees and monthly repayments will appear/)
  ).toBeInTheDocument();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).toHaveBeenCalledWith({
    action: 'book',
    equityPercentage: 50,
    tenure: 6,
  });
});
it('keeps slider and precise percentage in sync with kobo rounding', () => {
  render(
    <OxygenPlanForm busy={false} productAmount={100.01} submit={vi.fn()} />
  );
  fireEvent.change(
    screen.getByRole('slider', { name: 'Adjust down payment' }),
    { target: { value: '50' } }
  );
  expect(screen.getByLabelText('Your down payment')).toHaveValue('50.01');
  expect(screen.getByText('₦50.01')).toBeInTheDocument();
  expect(screen.getByText('₦50.00')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Your down payment'), {
    target: { value: '37.25' },
  });
  expect(screen.getByRole('slider')).toHaveValue('37.25');
});
it('blocks invalid and empty percentages without showing a fake zero', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm busy={false} productAmount={396000} submit={submit} />
  );
  fireEvent.change(screen.getByLabelText('Your down payment'), {
    target: { value: '' },
  });
  expect(screen.queryByText('₦0.00')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Review payment plan' })
  ).toBeDisabled();
  fireEvent.submit(screen.getByRole('form'));
  expect(submit).not.toHaveBeenCalled();
});

it('offers every five percent without booking while customers compare', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm busy={false} productAmount={396000} submit={submit} />
  );
  for (let percentage = 25; percentage <= 90; percentage += 5) {
    fireEvent.click(screen.getByRole('button', { name: `${percentage}%` }));
    expect(screen.getByLabelText('Down payment percentage')).toHaveTextContent(
      `${percentage}%`
    );
    expect(
      screen.getByRole('button', { name: `${percentage}%` })
    ).toHaveAttribute('aria-pressed', 'true');
  }
  expect(submit).not.toHaveBeenCalled();
});
