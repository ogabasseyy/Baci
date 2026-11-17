import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OxygenCustomerFormNavigation } from './OxygenCustomerFormNavigation';

afterEach(cleanup);

it.each([
  [0, 'Continue to bank details'],
  [1, 'Continue to income details'],
  [2, 'Continue verification'],
])('shows the correct submit action for step %i', (step, label) => {
  render(
    <OxygenCustomerFormNavigation
      step={step}
      busy={false}
      continuing={null}
      disabled={false}
      onBack={vi.fn()}
    />
  );

  expect(screen.getByRole('button', { name: label })).toHaveAttribute(
    'type',
    'submit'
  );
  if (step === 0) {
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  } else {
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
  }
});

it('enables the next action only when the form allows it', () => {
  const onBack = vi.fn();
  const view = render(
    <OxygenCustomerFormNavigation
      step={1}
      busy={false}
      continuing={null}
      disabled
      onBack={onBack}
    />
  );

  expect(
    screen.getByRole('button', { name: 'Continue to income details' })
  ).toBeDisabled();
  view.rerender(
    <OxygenCustomerFormNavigation
      step={1}
      busy={false}
      continuing={null}
      disabled={false}
      onBack={onBack}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Continue to income details' })
  ).toBeEnabled();
});

it('calls back on later steps and prevents navigation while busy', () => {
  const onBack = vi.fn();
  const view = render(
    <OxygenCustomerFormNavigation
      step={1}
      busy={false}
      continuing={null}
      disabled={false}
      onBack={onBack}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(onBack).toHaveBeenCalledTimes(1);

  view.rerender(
    <OxygenCustomerFormNavigation
      step={1}
      busy
      continuing={null}
      disabled
      onBack={onBack}
    />
  );
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Continue to income details' })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it.each([
  ['saving', 'Saving details…'],
  ['starting', 'Starting verification…'],
] as const)('disables navigation and shows progress while %s', (continuing, label) => {
  const onBack = vi.fn();
  render(
    <OxygenCustomerFormNavigation
      step={2}
      busy={false}
      continuing={continuing}
      disabled={false}
      onBack={onBack}
    />
  );

  const next = screen.getByRole('button', { name: label });
  expect(next).toBeDisabled();
  expect(next).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(onBack).not.toHaveBeenCalled();
});
