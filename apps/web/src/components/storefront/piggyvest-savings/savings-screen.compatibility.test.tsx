import {
  createPiggyvestDraftClosureController,
  createPiggyvestScheduleController,
} from '@baci/shared/lib';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { scheduleJourneyFixture } from '../../../../../../packages/shared/src/lib/piggyvest-schedule.test-support';
import { SavingsScreen } from './savings-screen';

it('keeps real schedule and closure ready without recursive guards and blocks sibling resume during close', async () => {
  const fixture = scheduleJourneyFixture();
  const source = piggyvestSavingsScreenSchema.parse(fixture.source);
  const schedule = createPiggyvestScheduleController(fixture.options);
  await schedule.refresh();
  let resolveClose: (value: unknown) => void = () => undefined;
  const close = vi.fn(
    () =>
      new Promise<unknown>((resolve) => {
        resolveClose = resolve;
      })
  );
  const closure = createPiggyvestDraftClosureController({
    source,
    tenantKey: 'synthetic',
    operationId: fixture.source.goalId,
    isCurrent: () => true,
    read: async () => ({
      status: 'available',
      goalId: fixture.source.goalId,
      revisionId: fixture.source.policy.revisionId,
      termsVersion: 'synthetic',
      termsHash: 'a'.repeat(64),
      action: 'close_plan',
    }),
    close,
  });
  await closure.refresh();
  render(
    <SavingsScreen
      source={source}
      scheduleBinding={schedule}
      draftClosureBinding={closure}
    />
  );
  expect(schedule.read(source)?.status).toBe('ready');
  expect(closure.read(source)?.status).toBe('review');
  expect(
    screen.getByRole('button', { name: 'Refresh schedule review' })
  ).toBeEnabled();
  const closeButton = screen.getByRole('button', { name: 'Close plan' });
  const section = closeButton.closest('section');
  if (!section) throw new Error('Expected closure section');
  fireEvent.click(within(section).getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(closeButton);
  });
  expect(
    screen.getByRole('button', { name: 'Save resume proposal' })
  ).toBeDisabled();
  expect(fixture.submit).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledOnce();
  await act(async () => {
    resolveClose({
      status: 'closed',
      goalId: fixture.source.goalId,
      revisionId: fixture.source.policy.revisionId,
      termsVersion: 'synthetic',
      termsHash: 'a'.repeat(64),
      action: 'close_plan',
      operationId: fixture.source.goalId,
      closedAt: '2026-09-12T00:00:00Z',
      refundIssued: false,
      providerWalletDeleted: false,
    });
  });
  expect(screen.getByText(/No refund issued/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Refresh plan closure' })
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Save resume proposal' })
  ).toBeDisabled();
});
