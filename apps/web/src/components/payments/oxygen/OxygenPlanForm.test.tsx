import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenPlanForm } from './OxygenPlanForm';

it('uses the overall eligibility cap in the selected offer guidance', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={100000}
      eligibleAmount={50000}
      minimumAmount={10000}
      maxTenure={1}
      submit={vi.fn()}
      offers={[{ tenure: 1, loanAmount: 90000 }]}
    />
  );
  fireEvent.change(screen.getByLabelText('Your down payment'), {
    target: { value: '30000' },
  });
  expect(
    screen.getByText(/increase your down payment to at least 50%/i)
  ).toBeVisible();
});

it('does not suggest an impossible down payment when the offer is below the minimum loan', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={100000}
      eligibleAmount={100000}
      minimumAmount={40000}
      maxTenure={3}
      submit={vi.fn()}
      offers={[
        { tenure: 1, loanAmount: 10000 },
        { tenure: 3, loanAmount: 100000 },
      ]}
    />
  );
  fireEvent.click(screen.getByRole('radio', { name: '1 month' }));
  expect(
    screen.getByText('This repayment period is not available for this order.')
  ).toBeVisible();
  expect(
    screen.queryByText(/increase your down payment/i)
  ).not.toBeInTheDocument();
});

it('requires a larger down payment when the selected period has a lower offer', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={198000}
      eligibleAmount={189000}
      minimumAmount={68000}
      maxTenure={3}
      submit={submit}
      offers={[
        { tenure: 1, loanAmount: 68000 },
        { tenure: 2, loanAmount: 131000 },
        { tenure: 3, loanAmount: 189000 },
      ]}
    />
  );
  fireEvent.click(screen.getByRole('radio', { name: '2 months' }));
  expect(
    screen.getByRole('button', { name: 'See full breakdown' })
  ).toBeDisabled();
  expect(screen.getByText(/increase your down payment/i)).toBeVisible();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).not.toHaveBeenCalled();
});

it('starts within the provider loan limits and offers only feasible down payments', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={198000}
      eligibleAmount={60000}
      minimumAmount={10000}
      maxTenure={3}
      submit={submit}
    />
  );
  expect(
    screen.getByRole('slider', { name: 'Adjust down payment' })
  ).toHaveAttribute('min', '69.7');
  expect(screen.getByLabelText('Down payment percentage')).toHaveTextContent(
    '69.7%'
  );
  expect(screen.queryByRole('button', { name: '25%' })).not.toBeInTheDocument();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).toHaveBeenCalledWith({
    action: 'book',
    equityPercentage: 69.7,
    tenure: 3,
  });
});

it('does not offer a plan when the minimum finance amount cannot be met', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={10000}
      eligibleAmount={10000}
      minimumAmount={10000}
      maxTenure={3}
      submit={vi.fn()}
    />
  );
  expect(screen.getByText(/no payment plan is available/i)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'See full breakdown' })
  ).not.toBeInTheDocument();
});

it('does not claim eligibility when the provider limits have not loaded', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={198000}
      maxTenure={3}
      submit={vi.fn()}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'We couldn’t load your payment options'
  );
  expect(screen.queryByText(/you’re eligible/i)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'See full breakdown' })
  ).not.toBeInTheDocument();
});

it('rejects a typed amount outside the eligible range', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={40000}
      eligibleAmount={25000}
      minimumAmount={10000}
      maxTenure={3}
      submit={submit}
    />
  );
  fireEvent.change(screen.getByLabelText('Your down payment'), {
    target: { value: '10000' },
  });
  expect(
    screen.getByRole('button', { name: 'See full breakdown' })
  ).toBeDisabled();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole('slider')).toHaveAttribute('min', '37.5');
  expect(screen.getByRole('slider')).toHaveAttribute('max', '75');
});

it('defaults to an available tenure when Oxygen allows fewer than three months', () => {
  const submit = vi.fn().mockResolvedValue(true);
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={396000}
      eligibleAmount={396000}
      minimumAmount={10000}
      maxTenure={1}
      submit={submit}
    />
  );
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
  render(
    <OxygenPlanForm
      busy
      productAmount={396000}
      eligibleAmount={396000}
      minimumAmount={10000}
      maxTenure={12}
      submit={submit}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Preparing your plan…' })
  ).toBeDisabled();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).not.toHaveBeenCalled();
});

it('keeps the initial selection simple and requests the full breakdown only on submit', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm
      busy={false}
      maxTenure={3}
      productAmount={198000}
      eligibleAmount={198000}
      minimumAmount={10000}
      submit={submit}
    />
  );
  expect(
    screen.getByText(/You’re eligible to spread your payment for up to/)
  ).toHaveTextContent(
    'You’re eligible to spread your payment for up to 3 months.'
  );
  expect(screen.queryByText('Your plan at a glance')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Payment plan preview' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '50%' }));
  expect(screen.getByLabelText('Your down payment')).toHaveValue('99,000');
  fireEvent.click(screen.getByRole('radio', { name: '2 months' }));
  expect(submit).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      'You’ll see monthly payments, charges and payment dates next.'
    )
  ).toBeInTheDocument();
  fireEvent.submit(screen.getByRole('form', { name: 'Choose payment plan' }));
  expect(submit).toHaveBeenCalledWith({
    action: 'book',
    equityPercentage: 50,
    tenure: 2,
  });
});
it('keeps slider and precise percentage in sync with kobo rounding', () => {
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={100.01}
      eligibleAmount={100.01}
      minimumAmount={1}
      maxTenure={3}
      submit={vi.fn()}
    />
  );
  fireEvent.change(
    screen.getByRole('slider', { name: 'Adjust down payment' }),
    { target: { value: '50' } }
  );
  expect(screen.getByLabelText('Your down payment')).toHaveValue('50.01');
  fireEvent.change(screen.getByLabelText('Your down payment'), {
    target: { value: '37.25' },
  });
  expect(screen.getByRole('slider')).toHaveValue('37.25');
});
it('blocks invalid and empty percentages without showing a fake zero', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={396000}
      eligibleAmount={396000}
      minimumAmount={10000}
      maxTenure={12}
      submit={submit}
    />
  );
  fireEvent.change(screen.getByLabelText('Your down payment'), {
    target: { value: '' },
  });
  expect(screen.queryByText('₦0.00')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'See full breakdown' })
  ).toBeDisabled();
  fireEvent.submit(screen.getByRole('form'));
  expect(submit).not.toHaveBeenCalled();
});

it('offers every five percent without booking while customers compare', () => {
  const submit = vi.fn();
  render(
    <OxygenPlanForm
      busy={false}
      productAmount={396000}
      eligibleAmount={396000}
      minimumAmount={10000}
      maxTenure={12}
      submit={submit}
    />
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
