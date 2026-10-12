import { expect, it, vi } from 'vitest';
import { scheduleJourneyFixture } from './piggyvest-schedule.test-support';

it('temporary sibling busy blocks resume but does not invalidate the schedule view', async () => {
  const fixture = scheduleJourneyFixture();
  const controller = createPiggyvestScheduleController(fixture.options);
  await controller.refresh();
  let compatible = false;
  controller.setCompatibilityGuard(() => compatible);
  expect(controller.read(fixture.source)?.status).toBe('ready');
  await expect(controller.requestResume(true, 1)).rejects.toThrow();
  expect(controller.getFundingBlocked()).toBe(false);
  compatible = true;
  await controller.requestResume(true, 1);
  expect(fixture.submit).toHaveBeenCalledTimes(2);
});

it('rejects consent captured before the same-source paused version advances', async () => {
  const fixture = scheduleJourneyFixture();
  const controller = createPiggyvestScheduleController(fixture.options);
  await controller.refresh();
  const displayedVersion = controller.read(fixture.source)?.snapshot?.state
    .version;
  const retained = () => controller.requestResume(true, displayedVersion);
  await controller.pause();
  const writes = fixture.submit.mock.calls.length;
  await expect(retained()).rejects.toThrow();
  expect(fixture.submit).toHaveBeenCalledTimes(writes);
});

it('funding snapshot invokes no external callback or live guard', async () => {
  const fixture = scheduleJourneyFixture();
  const controller = createPiggyvestScheduleController(fixture.options);
  await controller.refresh();
  fixture.options.isCurrent.mockClear();
  const guard = vi.fn(() => true);
  controller.setViewGuard(guard);
  expect(controller.getFundingBlocked()).toBe(false);
  expect(controller.getFundingBlocked()).toBe(false);
  expect(guard).not.toHaveBeenCalled();
  expect(fixture.options.isCurrent).not.toHaveBeenCalled();
});

import { createPiggyvestScheduleController } from './piggyvest-schedule-controller';

it('isolates throwing observers without interrupting dispatch or subsequent subscribers', async () => {
  const fixture = scheduleJourneyFixture();
  const controller = createPiggyvestScheduleController(fixture.options);
  const healthy = vi.fn();
  controller.subscribe(() => {
    throw new Error('Observer');
  });
  controller.subscribe(healthy);
  await controller.refresh();
  expect(healthy).toHaveBeenCalledTimes(2);
  expect(fixture.submit).toHaveBeenCalledTimes(1);
  expect(controller.read(fixture.source)?.status).toBe('ready');
});

it('requires explicit consent, locks double clicks and rebuilds exact server version', async () => {
  const fixture = scheduleJourneyFixture();
  const controller = createPiggyvestScheduleController(fixture.options);
  await controller.refresh();
  await expect(controller.requestResume(false, 1)).rejects.toThrow();
  expect(fixture.submit).toHaveBeenCalledTimes(1);
  const first = controller.requestResume(true, 1);
  await expect(controller.requestResume(true, 1)).rejects.toThrow();
  await first;
  expect(fixture.submit.mock.calls[1][0].command).toMatchObject({
    action: 'request_resume',
    expectedVersion: 1,
    accepted: true,
    revisionId: fixture.goalId,
    termsHash: 'a'.repeat(64),
  });
  expect(controller.read(fixture.source)?.snapshot?.state.status).toBe(
    'resume_proposed'
  );
});

it('keeps an uncertain pause blocked without issuing another operation, then recovers history separately', async () => {
  const fixture = scheduleJourneyFixture();
  const controller = createPiggyvestScheduleController(fixture.options);
  await controller.refresh();
  fixture.loseAcknowledgement();
  await expect(controller.pause()).rejects.toThrow('Schedule unavailable');
  expect(controller.getFundingBlocked()).toBe(true);
  await expect(controller.requestResume(true, 1)).rejects.toThrow();
  expect(fixture.submit).toHaveBeenCalledTimes(2);
  await controller.refresh();
  expect(controller.read(fixture.source)).toMatchObject({
    status: 'ready',
    historical: { command: { action: 'pause' } },
    snapshot: { state: { status: 'paused', version: 3 } },
  });
});

it('observes expiry or late credit without projecting historical resume as current authority on restart', async () => {
  const fixture = scheduleJourneyFixture();
  const controller = createPiggyvestScheduleController(fixture.options);
  await controller.refresh();
  await controller.requestResume(true, 1);
  const operationId = fixture.submit.mock.calls[1][0].operationId;
  fixture.invalidateProposal();
  const restarted = createPiggyvestScheduleController({
    ...fixture.options,
    recoveryOperationId: operationId,
  });
  await restarted.refresh();
  expect(restarted.read(fixture.source)).toMatchObject({
    historical: { receipt: { state: { status: 'resume_proposed' } } },
    snapshot: { state: { status: 'paused' }, debitPermission: false },
  });
});

it('invalidates A to null to A and callback ownership replacement during await', async () => {
  const fixture = scheduleJourneyFixture();
  const controller = createPiggyvestScheduleController(fixture.options);
  await controller.refresh();
  expect(controller.read(null)).toBeNull();
  expect(controller.read(fixture.source)).toBeNull();
  await expect(controller.pause()).rejects.toThrow();
  const second = createPiggyvestScheduleController(fixture.options);
  fixture.read.mockImplementationOnce(async () => {
    fixture.options.isCurrent.mockReturnValue(false);
    return fixture.snapshot();
  });
  await expect(second.refresh()).rejects.toThrow();
  expect(fixture.submit).toHaveBeenCalledTimes(1);
});

it('fails closed on wrong revision, malformed source, duplicate operation and false ACK', async () => {
  const fixture = scheduleJourneyFixture();
  expect(() =>
    createPiggyvestScheduleController({
      ...fixture.options,
      source: { ...fixture.source, extra: true },
    })
  ).toThrow();
  const controller = createPiggyvestScheduleController(fixture.options);
  await controller.refresh();
  fixture.options.nextOperationId.mockReturnValue(
    fixture.submit.mock.calls[0][0].operationId
  );
  await expect(controller.pause()).rejects.toThrow();
  expect(fixture.submit).toHaveBeenCalledTimes(1);
  const other = scheduleJourneyFixture();
  other.read.mockResolvedValue({
    ...other.snapshot(),
    termsHash: 'b'.repeat(64),
  });
  await expect(
    createPiggyvestScheduleController(other.options).refresh()
  ).rejects.toThrow();
  expect(other.submit).not.toHaveBeenCalled();
  const falseAck = scheduleJourneyFixture();
  falseAck.submit.mockImplementationOnce(async () => ({
    goalId: falseAck.goalId,
    status: 'persisted_proposal',
    dispatch: 'disabled',
    debitPermission: false,
    receipt: {
      operationId: falseAck.goalId,
      persisted: true,
      dispatch: 'disabled',
      debitPermission: false,
      state: { version: 1, status: 'paused', consentProposal: null },
    },
  }));
  const guarded = createPiggyvestScheduleController(falseAck.options);
  await expect(guarded.refresh()).rejects.toThrow();
  expect(guarded.read(falseAck.source)?.status).toBe('uncertain');
});
