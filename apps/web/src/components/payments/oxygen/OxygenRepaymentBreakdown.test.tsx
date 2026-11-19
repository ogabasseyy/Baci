import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OxygenRepaymentBreakdown } from './OxygenRepaymentBreakdown';

it('renders upfront charges and each quoted repayment in currency units', () => {
  render(
    <OxygenRepaymentBreakdown
      quote={{
        productMinor: 100000,
        equityPercentage: 25,
        equityMinor: 25000,
        principalMinor: 75000,
        chargesMinor: 1000,
        upfrontMinor: 26000,
        totalRepaymentMinor: 80000,
        interestMinor: 5000,
        managementMinor: 500,
        insuranceMinor: 250,
        vatMinor: 250,
        tenureMonths: 2,
        instalmentsMinor: [40000, 40000],
      }}
    />
  );
  expect(
    screen.getByRole('group', { name: 'Payment breakdown' })
  ).toBeVisible();
  expect(screen.getByText('Instalment 1')).toBeVisible();
  expect(screen.getByText('Instalment 2')).toBeVisible();
  expect(screen.getByText('₦1,060.00')).toBeVisible();
});
