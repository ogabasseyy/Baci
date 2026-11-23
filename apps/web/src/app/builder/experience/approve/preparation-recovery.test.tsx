import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const prepare = vi.hoisted(() => vi.fn());
vi.mock('./prepare-approval', () => ({ prepareApprovalUntilReady: prepare }));

import { ExperiencePreparationRecovery } from './preparation-recovery';

const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => {
  cleanup();
  prepare.mockReset();
});

it('starts recovery only after the owner asks and shows preparation failure', async () => {
  prepare.mockRejectedValue(Error('revision changed'));
  render(<ExperiencePreparationRecovery approvalId={id} kind="lifecycle" />);
  expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Resume preparation' }));
  expect(prepare).toHaveBeenCalledWith({
    approvalId: id,
    action: 'prepare-publication',
    signal: expect.any(AbortSignal),
  });
  expect(await screen.findByText(/Preparation could not resume/)).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Resume preparation' })
  ).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
});

it('aborts pending recovery when the owner leaves the page', () => {
  prepare.mockReturnValue(new Promise(() => {}));
  const view = render(
    <ExperiencePreparationRecovery approvalId={id} kind="draft" />
  );
  const button = screen.getByRole('button', { name: 'Resume preparation' });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  const signal = prepare.mock.calls[0]?.[0].signal;
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
});
