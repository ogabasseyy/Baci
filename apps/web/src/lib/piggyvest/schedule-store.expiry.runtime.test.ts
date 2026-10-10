import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';

vi.mock('server-only', () => ({}));
const enabled = process.env.PIGGYVEST_RUN_SCHEDULE_STORE === '1';
const restart = process.env.PIGGYVEST_SCHEDULE_RESTART === '1';
const expired = process.env.PIGGYVEST_SCHEDULE_EXPIRED === '1';
const operationId = 'c0000000-0000-4000-8000-000000000401';
afterEach(() => vi.unstubAllGlobals());

describe.skipIf(!enabled)(
  'accepted quote expiry in restricted local PostgreSQL',
  () => {
    it.skipIf(restart || expired)(
      'persists resume before accepted quote expiry without debit permission',
      async () => {
        vi.stubGlobal('fetch', () => {
          throw new Error('External HTTP prohibited');
        });
        const test = scheduleStoreRuntimeFixture(401);
        const snapshot = await test.store.read();
        const request = {
          operationId,
          command: {
            action: 'request_resume',
            goalId: test.goalId,
            expectedVersion: 0,
            accepted: true,
            operationId,
            revisionId: snapshot.trusted.revisionId,
            termsHash: snapshot.trusted.termsHash,
          },
        };
        expect(await test.store.submit(request)).toMatchObject({
          status: 'persisted_proposal',
          receipt: {
            debitPermission: false,
            state: { version: 1, status: 'resume_proposed' },
          },
        });
      }
    );

    it.skipIf(restart || !expired)(
      'durably observes expiry without rewriting historical resume',
      async () => {
        vi.stubGlobal('fetch', () => {
          throw new Error('External HTTP prohibited');
        });
        const test = scheduleStoreRuntimeFixture(401);
        const snapshot = await test.store.read(operationId);
        const request = { operationId, command: snapshot.historical?.command };
        expect(
          await test.store.submit({
            operationId: 'd0000000-0000-4000-8000-000000000401',
            command: {
              action: 'observe',
              goalId: test.goalId,
              expectedVersion: 1,
            },
          })
        ).toMatchObject({
          status: 'persisted_proposal',
          receipt: {
            debitPermission: false,
            state: { version: 2, status: 'paused', consentProposal: null },
          },
        });
        expect(await test.store.submit(request)).toMatchObject({
          status: 'persisted_proposal',
          receipt: {
            debitPermission: false,
            state: { version: 1, status: 'resume_proposed' },
          },
        });
        const freshId = 'f0000000-0000-4000-8000-000000000401';
        expect(
          await test.store.submit({
            operationId: freshId,
            command: {
              ...snapshot.historical?.command,
              expectedVersion: 2,
              operationId: freshId,
            },
          })
        ).toMatchObject({ status: 'unconfirmed' });
        expect((await test.store.read(freshId)).historical).toBeNull();
        expect((await test.store.read()).state).toMatchObject({
          version: 2,
          status: 'paused',
          consentProposal: null,
        });
      }
    );

    it.skipIf(!restart)(
      'reads current paused state separately from historical resume after restart',
      async () => {
        const test = scheduleStoreRuntimeFixture(401);
        const snapshot = await test.store.read(operationId);
        expect(snapshot.state).toMatchObject({
          version: 2,
          status: 'paused',
          consentProposal: null,
        });
        expect(snapshot.historical?.receipt).toMatchObject({
          debitPermission: false,
          dispatch: 'disabled',
          state: { version: 1, status: 'resume_proposed' },
        });
      }
    );
  }
);
