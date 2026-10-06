// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { piggyvestCustomerDraftClosureSchemas as schemas } from '@/schemas/piggyvest-customer-draft-closure';
import { draftClosureLocalFixture } from './customer-draft-closure-local.test-fixture';
import { DRAFT_CLOSURE_STATEMENTS as statements } from './draft-closure-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

vi.mock('server-only', () => ({}));
const restart = process.env.PIGGYVEST_CLOSURE_RESTART === '1';
const { goal, database, admin, parameters, server, waitForLock } =
  draftClosureLocalFixture;
describe.skipIf(process.env.PIGGYVEST_RUN_DRAFT_CLOSURE !== '1')(
  'actual closure HTTP and restricted PostgreSQL',
  () => {
    it.skipIf(restart)(
      'closes only the reviewed unexposed draft with auth, CSRF, replay and readback',
      async () => {
        const runtime = await server(813);
        try {
          const path = `${runtime.origin}/close-plan?goalId=${goal(813)}`;
          expect((await fetch(path)).status).toBe(401);
          expect(
            (
              await fetch(path, {
                headers: { cookie: 'synthetic-session=other' },
              })
            ).status
          ).toBe(403);
          const headers = {
            cookie: 'synthetic-session=owner',
            origin: runtime.origin,
          };
          const reviewResponse = await fetch(
            `${runtime.origin}/close-plan?goalId=${goal(813).toUpperCase()}`,
            { headers }
          );
          expect(reviewResponse.status).toBe(200);
          const review = schemas.response.parse(await reviewResponse.json());
          if (review.status !== 'available')
            throw new Error('Expected unexposed draft');
          const command = {
            goalId: review.goalId.toUpperCase(),
            operationId: goal(813).toUpperCase(),
            revisionId: review.revisionId.toUpperCase(),
            termsVersion: review.termsVersion,
            termsHash: review.termsHash,
            accepted: true,
          };
          const post = (
            body: unknown,
            requestHeaders: Record<string, string>
          ) =>
            fetch(`${runtime.origin}/close-plan`, {
              method: 'POST',
              headers: {
                ...requestHeaders,
                'content-type': 'application/json',
              },
              body: JSON.stringify(body),
            });
          expect((await post(command, headers)).status).toBe(403);
          const csrfResponse = await fetch(`${runtime.origin}/csrf`, {
            headers,
          });
          expect(csrfResponse.status).toBe(200);
          const { csrfToken } = await csrfResponse.json();
          const cookie = csrfResponse.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');
          const authorized = {
            ...headers,
            cookie: `${headers.cookie}; ${cookie}`,
            'x-csrf-token': csrfToken,
          };
          expect(
            (
              await post(
                { ...command, actorId: parameters(813)[5] },
                authorized
              )
            ).status
          ).toBe(400);
          expect(
            (await post({ ...command, termsHash: 'a'.repeat(64) }, authorized))
              .status
          ).toBe(503);
          const response = await post(command, authorized);
          expect(response.status).toBe(200);
          const receipt = schemas.response.parse(await response.json());
          expect(receipt).toMatchObject({
            status: 'closed',
            goalId: goal(813),
            refundIssued: false,
            providerWalletDeleted: false,
          });
          expect(await (await post(command, authorized)).json()).toEqual(
            receipt
          );
          expect(await (await fetch(path, { headers })).json()).toEqual(
            receipt
          );
          expect(response.headers.get('cache-control')).toBe('no-store');
        } finally {
          await runtime.close();
        }
      }
    );
    it.skipIf(restart)(
      'returns reconciliation-required for the existing mapped fixture without changing it',
      async () => {
        const runtime = await server(1);
        try {
          const response = await fetch(
            `${runtime.origin}/close-plan?goalId=${goal(1)}`,
            { headers: { cookie: 'synthetic-session=owner' } }
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({
            status: 'requires_reconciliation',
            goalId: goal(1),
            reason: 'provider_zero_unverified',
          });
        } finally {
          await runtime.close();
        }
      }
    );
    it.skipIf(restart)(
      'serializes provisioning exposure before closure and observes the committed exposure',
      async () => {
        const blocker = await admin();
        const observer = await admin();
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            `INSERT INTO piggyvest_staging.provisioning_intents
        (integration_id,merchant_id,customer_id,goal_id,operation,request_fingerprint)
        VALUES($1,$2,$3,$4,'create_plan_wallet',decode(repeat('ab',32),'hex'))`,
            parameters(814).slice(0, 4)
          );
          const { rows } = await blocker.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid'
          );
          const pending = createPiggyvestPostgresExecutor(database())(
            statements.readDraftClosure.text,
            parameters(814)
          );
          await waitForLock(observer, rows[0].pid);
          await blocker.query('COMMIT');
          expect(
            schemas.rows.parse((await pending).rows)[0].result.status
          ).toBe('requires_reconciliation');
        } finally {
          await blocker.query('ROLLBACK');
          await blocker.end();
          await observer.end();
        }
      }
    );
    it.skipIf(restart)(
      'closure wins the goal lock and rejects a subsequent provisioning insert',
      async () => {
        const blocker = await admin();
        const writer = await admin();
        const observer = await admin();
        try {
          await blocker.query('BEGIN');
          const { rows } = await blocker.query<{ pid: number }>(
            'SELECT pg_backend_pid() AS pid'
          );
          await blocker.query(
            'SET SESSION AUTHORIZATION piggyvest_staging_policy_writer'
          );
          await blocker.query('SELECT closure_test.close(815)');
          const pending = writer
            .query(
              `INSERT INTO piggyvest_staging.provisioning_intents
        (integration_id,merchant_id,customer_id,goal_id,operation,request_fingerprint)
        VALUES($1,$2,$3,$4,'create_plan_wallet',decode(repeat('ab',32),'hex'))`,
              parameters(815).slice(0, 4)
            )
            .then(
              () => 'unexpected success',
              (error: unknown) =>
                error instanceof Error ? error.message : 'rejected'
            );
          await waitForLock(observer, rows[0].pid);
          await blocker.query('COMMIT');
          expect(await pending).toContain('closed draft activity denied');
        } finally {
          await blocker.query('ROLLBACK');
          await blocker.end();
          await writer.end();
          await observer.end();
        }
      }
    );
    it.skipIf(!restart)(
      'recovers committed closure after restart without financial disposition',
      async () => {
        const runtime = await server(813);
        try {
          const response = await fetch(
            `${runtime.origin}/close-plan?goalId=${goal(813)}`,
            { headers: { cookie: 'synthetic-session=owner' } }
          );
          expect(response.status).toBe(200);
          expect(schemas.response.parse(await response.json())).toMatchObject({
            status: 'closed',
            operationId: goal(813).toUpperCase(),
            refundIssued: false,
            providerWalletDeleted: false,
          });
        } finally {
          await runtime.close();
        }
      }
    );
  }
);
