import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenPlanRequired } from './OxygenPlanRequired';

vi.mock('./OxygenPlanForm', () => ({
  OxygenPlanForm: ({ busy }: { busy: boolean }) => (
    <div>Plan form {busy ? 'disabled' : 'enabled'}</div>
  ),
}));
it.each([
  undefined,
  [],
])('requests updated options when offers are missing or empty', (offers) => {
  const submit = vi.fn().mockResolvedValue(true);
  render(
    <OxygenPlanRequired state={{ offers }} disabled={false} submit={submit} />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Update payment options' })
  );
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    action: 'refresh_eligibility',
  });
});
it('disables refresh while busy', () => {
  render(<OxygenPlanRequired state={{}} disabled submit={vi.fn()} />);
  expect(
    screen.getByRole('button', { name: 'Update payment options' })
  ).toBeDisabled();
});
it('renders available offers and propagates disabled state', () => {
  render(
    <OxygenPlanRequired
      state={{ offers: [{ tenure: 3, loanAmount: 100000 }] }}
      disabled
      submit={vi.fn()}
    />
  );
  expect(screen.getByText('Plan form disabled')).toBeVisible();
});
