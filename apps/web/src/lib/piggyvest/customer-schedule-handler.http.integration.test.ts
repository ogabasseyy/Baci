// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { piggyvestCustomerScheduleHandlerSchemas as schemas } from '@/schemas/piggyvest-customer-schedule-handler';
import { startCustomerScheduleHttpFixture } from './customer-schedule-handler.http-support';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

vi.mock('server-only', () => ({}));
const enabled = process.env.PIGGYVEST_RUN_SCHEDULE_HTTP === '1';
const expired = process.env.PIGGYVEST_SCHEDULE_EXPIRED === '1';
const restart = process.env.PIGGYVEST_SCHEDULE_RESTART === '1';
const operationId = 'c0000000-0000-4000-8000-000000000402';
const listeners: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
});
async function start(loss = false) {
  const server = await startCustomerScheduleHttpFixture(loss);
  listeners.push(server);
  return server;
}

describe.skipIf(!enabled)(
  'synthetic session and real loopback HTTP to restricted schedule PostgreSQL',
  () => {
    it.skipIf(expired || restart)(
      'bootstraps real CSRF and recovers a lost committed resume via HTTP and exact replay',
      async () => {
        const server = await start(true);
        const denied = await server.localFetch(
          `/schedule?goalId=${server.goalId}`
        );
        expect(denied.status).toBe(401);
        expect(server.execute).not.toHaveBeenCalled();
        await server.bootstrap();
        const initial = await server.get();
        expect(initial.status).toBe(200);
        const source = schemas.snapshot.parse(await initial.json());
        const command = {
          operationId,
          command: {
            action: 'request_resume',
            goalId: server.goalId,
            expectedVersion: source.state.version,
            operationId,
            revisionId: source.revisionId,
            termsHash: source.termsHash,
            accepted: true,
          },
        };
        const calls = server.execute.mock.calls.length;
        const csrfDenied = await server.localFetch('/schedule', {
          method: 'POST',
          headers: {
            cookie: 'synthetic-session=owner',
            origin: server.origin,
            'content-type': 'application/json',
          },
          body: JSON.stringify(command),
        });
        expect(csrfDenied.status).toBe(403);
        expect((await server.post({ ...command, proposal: {} })).status).toBe(
          400
        );
        expect(server.execute.mock.calls).toHaveLength(calls);
        const uncertain = await server.post(command);
        expect(uncertain.status).toBe(503);
        expect(schemas.uncertain.parse(await uncertain.json())).toMatchObject({
          operationId,
          goalId: server.goalId,
          readbackRequired: true,
          debitPermission: false,
        });
        const snapshot = schemas.snapshot.parse(
          await (await server.get(operationId)).json()
        );
        expect(snapshot.state).toMatchObject({
          version: 1,
          status: 'resume_proposed',
        });
        expect(snapshot.historical?.receipt).toMatchObject({
          operationId,
          persisted: true,
          debitPermission: false,
        });
        const writes = server.execute.mock.calls.filter(
          ([statement]) =>
            statement === SCHEDULE_STORE_STATEMENTS.writeScheduleProposal.text
        ).length;
        const replay = await server.post(command);
        expect(replay.status).toBe(200);
        expect(schemas.success.parse(await replay.json()).receipt).toEqual(
          snapshot.historical?.receipt
        );
        expect(
          server.execute.mock.calls.filter(
            ([statement]) =>
              statement === SCHEDULE_STORE_STATEMENTS.writeScheduleProposal.text
          )
        ).toHaveLength(writes);
        expect(JSON.stringify(snapshot)).not.toMatch(
          /actorId|customerId|merchantId|token|trusted|private SQL marker/
        );
      }
    );

    it.skipIf(!expired || restart)(
      'commits safe observe after quote expiry while preserving non-authorizing history',
      async () => {
        const server = await start();
        await server.bootstrap();
        const original = schemas.snapshot.parse(
          await (await server.get(operationId)).json()
        );
        expect(original.state).toMatchObject({
          version: 1,
          status: 'resume_proposed',
        });
        const response = await server.post({
          operationId: 'd0000000-0000-4000-8000-000000000402',
          command: {
            action: 'observe',
            goalId: server.goalId,
            expectedVersion: 1,
          },
        });
        expect(response.status).toBe(200);
        expect(schemas.success.parse(await response.json())).toMatchObject({
          debitPermission: false,
          receipt: {
            state: { version: 2, status: 'paused', consentProposal: null },
          },
        });
        const replay = await server.post({
          operationId,
          command: original.historical?.command,
        });
        expect(replay.status).toBe(200);
        expect(schemas.success.parse(await replay.json()).receipt).toEqual(
          original.historical?.receipt
        );
        const freshId = 'f0000000-0000-4000-8000-000000000402';
        expect(
          (
            await server.post({
              operationId: freshId,
              command: {
                ...original.historical?.command,
                expectedVersion: 2,
                operationId: freshId,
              },
            })
          ).status
        ).toBe(503);
        const readback = schemas.snapshot.parse(
          await (await server.get(freshId)).json()
        );
        expect(readback.historical).toBeNull();
        expect(readback.state).toMatchObject({
          version: 2,
          status: 'paused',
          consentProposal: null,
        });
      }
    );

    it.skipIf(!restart)(
      'reads current paused state and old resume independently after database and listener restart',
      async () => {
        const server = await start();
        await server.bootstrap();
        const snapshot = schemas.snapshot.parse(
          await (await server.get(operationId)).json()
        );
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
        expect(
          server.execute.mock.calls.every(
            ([statement]) =>
              statement === SCHEDULE_STORE_STATEMENTS.readScheduleProposal.text
          )
        ).toBe(true);
      }
    );
  }
);
