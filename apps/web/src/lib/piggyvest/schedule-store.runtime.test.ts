import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';
import { SCHEDULE_STORE_STATEMENTS as statements } from './schedule-store-statements';

vi.mock('server-only', () => ({}));
const forbidden = vi.fn(() => {
  throw new Error('External HTTP prohibited');
});
beforeEach(() => {
  forbidden.mockClear();
  vi.stubGlobal('fetch', forbidden);
});
afterEach(() => {
  expect(forbidden).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
const operationId = 'c0000000-0000-4000-8000-000000000101';
const enabled = process.env.PIGGYVEST_RUN_SCHEDULE_STORE === '1';
const restart = process.env.PIGGYVEST_SCHEDULE_RESTART === '1';

describe.skipIf(!enabled || restart)(
  'restricted PostgreSQL and synthetic Supabase authenticated schedule connection',
  () => {
    it('persists despite response loss, reconstructs through readback, and replays without another write', async () => {
      const test = scheduleStoreRuntimeFixture();
      const snapshot = await test.store.read();
      const request = {
        operationId,
        command: {
          action: 'request_resume',
          expectedVersion: snapshot.state.version,
          goalId: test.goalId,
          accepted: true,
          operationId,
          revisionId: snapshot.trusted.revisionId,
          termsHash: snapshot.trusted.termsHash,
        },
      };
      test.execute.mockImplementation(async (statement, parameters) => {
        const response = await test.database(statement, parameters);
        if (statement === statements.writeScheduleProposal.text)
          throw new Error('Synthetic committed response loss');
        return response;
      });
      expect(await test.store.submit(request)).toMatchObject({
        status: 'unconfirmed',
        readbackRequired: true,
      });
      const recovered = scheduleStoreRuntimeFixture();
      const readback = await recovered.store.read(operationId);
      expect(readback.historical?.receipt).toMatchObject({
        persisted: true,
        debitPermission: false,
        state: { version: 1, status: 'resume_proposed' },
      });
      expect(await recovered.store.submit(request)).toEqual({
        status: 'persisted_proposal',
        receipt: readback.historical?.receipt,
      });
      expect(
        recovered.execute.mock.calls.every(
          ([statement]) => statement === statements.readScheduleProposal.text
        )
      ).toBe(true);
      expect(
        await recovered.store.submit({
          ...request,
          command: { ...request.command, expectedVersion: 1 },
        })
      ).toMatchObject({ status: 'unconfirmed' });
    });

    it('serializes simultaneous resume and pause at the same optimistic version', async () => {
      const test = scheduleStoreRuntimeFixture(201);
      const snapshot = await test.store.read();
      const resumeId = 'c0000000-0000-4000-8000-000000000201';
      const resume = {
        operationId: resumeId,
        command: {
          action: 'request_resume',
          goalId: test.goalId,
          expectedVersion: 0,
          accepted: true,
          operationId: resumeId,
          revisionId: snapshot.trusted.revisionId,
          termsHash: snapshot.trusted.termsHash,
        },
      };
      const pause = {
        operationId: 'd0000000-0000-4000-8000-000000000201',
        command: { action: 'pause', goalId: test.goalId, expectedVersion: 0 },
      };
      const results = await Promise.all([
        test.store.submit(resume),
        test.store.submit(pause),
      ]);
      expect(
        results.filter((result) => result.status === 'persisted_proposal')
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'unconfirmed')
      ).toHaveLength(1);
      expect((await test.store.read()).state.version).toBe(1);
    });

    it('rejects an unauthenticated caller before storage and rejects caller-selected actor', async () => {
      const test = scheduleStoreRuntimeFixture(202);
      test.getUser.mockResolvedValue({ data: { user: null }, error: null });
      expect(await test.store.submit(null)).toMatchObject({
        status: 'unconfirmed',
      });
      expect(test.execute).not.toHaveBeenCalled();
      expect(test.from).not.toHaveBeenCalled();
      test.getUser.mockResolvedValue({
        data: { user: { id: test.actorId } },
        error: null,
      });
      expect(
        await test.store.submit({
          operationId,
          actorId: test.actorId,
          command: { action: 'pause', goalId: test.goalId, expectedVersion: 0 },
        })
      ).toMatchObject({ status: 'unconfirmed' });
      expect(test.execute).not.toHaveBeenCalled();
    });
  }
);

describe.skipIf(!enabled || !restart)(
  'read-only recovery after PostgreSQL restart',
  () => {
    it('reads the same durable receipt without resubmitting or granting debit permission', async () => {
      const test = scheduleStoreRuntimeFixture();
      const snapshot = await test.store.read(operationId);
      expect(snapshot.historical?.receipt).toMatchObject({
        operationId,
        persisted: true,
        debitPermission: false,
        dispatch: 'disabled',
        state: { version: 1, status: 'resume_proposed' },
      });
      expect(test.execute).toHaveBeenCalledTimes(1);
      expect(test.execute.mock.calls[0][0]).toBe(
        statements.readScheduleProposal.text
      );
    });
  }
);
