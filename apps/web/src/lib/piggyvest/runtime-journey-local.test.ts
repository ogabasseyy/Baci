// @vitest-environment node

import { piggyvestCancellationReviewSchemas } from '@baci/shared/contracts';
import { describe, expect, it, vi } from 'vitest';
import { startRuntimeJourneyLocal } from './runtime-journey-local';
import { applyRuntimeJourneyFixture } from './runtime-journey-local-fixture';

vi.mock('server-only', () => ({}));

describe.skipIf(process.env.PIGGYVEST_RUN_RUNTIME_JOURNEY !== '1')(
  'packaged HTTP and restricted PG journey',
  () => {
    it('connects authentication, CSRF, duration consent and verified funding for distinct variants', async () => {
      for (const sequence of [701, 702] as const) {
        const server = await startRuntimeJourneyLocal({
          socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
          sequence,
        });
        try {
          expect(
            (await fetch(`${server.origin}/funding?goalId=${server.goalId}`))
              .status
          ).toBe(401);
          const csrf = await server.bootstrap();
          const response = await server.request(
            `/policy?goalId=${server.goalId}`
          );
          expect(response.status).toBe(200);
          const policy = await response.json();
          expect(policy).toMatchObject({
            consent: 'required',
            device: { variant: sequence === 701 ? '256GB' : '512GB' },
          });
          expect(
            (
              await server.request('/policy', {
                method: 'POST',
                body: JSON.stringify({}),
                headers: { 'x-csrf-token': 'wrong' },
              })
            ).status
          ).toBe(403);
          expect(
            (
              await server.request('/lifecycle/terms', {
                method: 'POST',
                body: JSON.stringify({
                  goalId: server.goalId,
                  revisionId: server.revisionId,
                  durationMonths: 1,
                }),
              })
            ).status
          ).toBe(200);
          const accepted = await server.request('/policy', {
            method: 'POST',
            body: JSON.stringify({
              goalId: server.goalId,
              revisionId: server.revisionId,
              termsVersion: policy.terms.version,
              termsHash: policy.terms.hash,
              durationMonths: 1,
              accepted: true,
            }),
          });
          expect(accepted.status).toBe(200);
          expect(await accepted.json()).toMatchObject({
            consent: 'accepted',
            durationMonths: 1,
          });
          const funding = await server.request(
            `/funding?goalId=${server.goalId}`
          );
          expect(funding.status).toBe(200);
          expect(await funding.json()).toMatchObject({
            funding: { status: 'ready' },
            eligibility: { status: 'allowed' },
            progress: { status: 'unavailable' },
          });
          expect(server.providerCalls).toHaveLength(2);
          expect(csrf.csrfToken).toBeTruthy();
          const other = await fetch(
            `${server.origin}/funding?goalId=${server.goalId}`,
            { headers: { cookie: 'synthetic-session=other' } }
          );
          expect(other.status).toBe(403);
          expect(
            (
              await server.request(
                '/funding?goalId=30000000-0000-4000-8000-000000000001'
              )
            ).status
          ).toBe(403);
          const schedule = await server.request(
            `/schedule?goalId=${server.goalId}`
          );
          expect(schedule.status).toBe(200);
          const state = await schedule.json();
          const pause = await server.request('/schedule', {
            method: 'POST',
            body: JSON.stringify({
              operationId: `a0000000-0000-4000-8000-000000000${sequence}`,
              command: {
                action: 'pause',
                goalId: server.goalId,
                expectedVersion: state.state.version,
              },
            }),
          });
          expect(pause.status).toBe(200);
          expect(await pause.json()).toMatchObject({
            status: 'persisted_proposal',
            debitPermission: false,
            dispatch: 'disabled',
          });
          const fixture = {
            socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
            sequence,
            action: 'credit' as const,
          };
          applyRuntimeJourneyFixture(fixture);
          applyRuntimeJourneyFixture(fixture);
          if (sequence === 701) {
            const command = {
              goalId: server.goalId,
              revisionId: server.revisionId,
              operationId: '80000000-0000-4000-8000-000000000701',
            };
            const activated = await server.request('/lifecycle/activate', {
              method: 'POST',
              body: JSON.stringify(command),
            });
            expect(activated.status).toBe(200);
            const receipt = await activated.json();
            expect(receipt).toMatchObject({
              goalId: server.goalId,
              lifecycle: 'active',
              evidence: 'local_synthetic_only',
            });
            const replay = await server.request('/lifecycle/activate', {
              method: 'POST',
              body: JSON.stringify(command),
            });
            expect(replay.status).toBe(200);
            expect(await replay.json()).toEqual(receipt);
          } else {
            const quoteResponse = await server.request(
              `/cancel?goalId=${server.goalId}`
            );
            expect(quoteResponse.status).toBe(200);
            const quote = piggyvestCancellationReviewSchemas.quote.parse(
              await quoteResponse.json()
            );
            if (quote.status !== 'quote_available')
              throw new Error('Synthetic cancellation unavailable');
            expect(quote.principalKobo).toBe(5000);
            expect(quote.paidInterestKobo).toBe(0);
            const command =
              piggyvestCancellationReviewSchemas.confirmation.parse({
                goalId: server.goalId,
                operationId: '80000000-0000-4000-8000-000000000702',
                revisionId: quote.revisionId,
                termsVersion: quote.termsVersion,
                termsHash: quote.termsHash,
                consentVersion: quote.consentVersion,
                principalKobo: quote.principalKobo,
                paidInterestKobo: quote.paidInterestKobo,
                pendingInterestKobo: quote.pendingInterestKobo,
                accepted: true,
              });
            for (let replay = 0; replay < 2; replay++) {
              const prepared = await server.request('/cancel', {
                method: 'POST',
                body: JSON.stringify(command),
              });
              expect(prepared.status).toBe(200);
              expect(await prepared.json()).toMatchObject({
                status: 'prepared',
                dispatch: 'contract_gap',
                operationId: command.operationId,
              });
            }
            const recovery = await server.request(
              `/recovery?goalId=${server.goalId}&operationId=${command.operationId}`
            );
            expect(recovery.status).toBe(200);
            expect(await recovery.json()).toMatchObject({
              status: 'prepared',
              reservation: 'retained',
              dispatch: 'contract_gap',
            });
            const stopped = await server.request(
              `/funding?goalId=${server.goalId}`
            );
            expect(await stopped.json()).not.toMatchObject({
              funding: { status: 'ready' },
            });
          }
        } finally {
          await server.close();
        }
      }
    }, 30000);
    it('expires persisted schedule consent without collecting or inventing provider events', async () => {
      const server = await startRuntimeJourneyLocal({
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        sequence: 703,
      });
      try {
        await server.bootstrap();
        const policy = await (
          await server.request(`/policy?goalId=${server.goalId}`)
        ).json();
        expect(
          (
            await server.request('/lifecycle/terms', {
              method: 'POST',
              body: JSON.stringify({
                goalId: server.goalId,
                revisionId: server.revisionId,
                durationMonths: 1,
              }),
            })
          ).status
        ).toBe(200);
        expect(
          (
            await server.request('/policy', {
              method: 'POST',
              body: JSON.stringify({
                goalId: server.goalId,
                revisionId: server.revisionId,
                termsVersion: policy.terms.version,
                termsHash: policy.terms.hash,
                durationMonths: 1,
                accepted: true,
              }),
            })
          ).status
        ).toBe(200);
        const before = await (
          await server.request(`/schedule?goalId=${server.goalId}`)
        ).json();
        const resume = {
          operationId: 'a0000000-0000-4000-8000-000000000703',
          command: {
            action: 'request_resume',
            goalId: server.goalId,
            expectedVersion: before.state.version,
            accepted: true,
            operationId: 'a0000000-0000-4000-8000-000000000703',
            revisionId: server.revisionId,
            termsHash: policy.terms.hash,
          },
        };
        const resumed = await server.request('/schedule', {
          method: 'POST',
          body: JSON.stringify(resume),
        });
        expect(resumed.status).toBe(200);
        const saved = await resumed.json();
        expect(saved).toMatchObject({
          receipt: { state: { status: 'resume_proposed' } },
          debitPermission: false,
        });
        applyRuntimeJourneyFixture({
          socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
          sequence: 703,
          action: 'expire',
        });
        const observed = await server.request('/schedule', {
          method: 'POST',
          body: JSON.stringify({
            operationId: 'a0000000-0000-4000-8000-000000000704',
            command: {
              action: 'observe',
              goalId: server.goalId,
              expectedVersion: saved.receipt.state.version,
            },
          }),
        });
        expect(observed.status).toBe(200);
        expect(await observed.json()).toMatchObject({
          receipt: { state: { status: 'paused', consentProposal: null } },
          debitPermission: false,
          dispatch: 'disabled',
        });
        expect(server.providerCalls).toHaveLength(0);
      } finally {
        await server.close();
      }
    }, 90000);
  }
);
