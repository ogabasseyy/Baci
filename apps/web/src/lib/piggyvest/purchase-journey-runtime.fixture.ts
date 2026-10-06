import { AuthError } from '@supabase/supabase-js';
import { expect } from 'vitest';
import { stage, termsDocument } from './customer-purchase-http.fixture';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import {
  authenticatedReader,
  configuration,
  database,
  goal,
  query,
} from './purchase-pricing-runtime.fixture';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

export async function purchaseJourneyFixture() {
  const goalId = goal(243);
  const revisionId = await stage(243, 300);
  const runtime = await startPiggyvestRuntimeCompositionServer({
    port: 0,
    browserOrigin: 'http://127.0.0.1:4184',
    csrfCookiePath: '/scenario/243',
    configuration: {
      mode: 'local_test',
      goalId,
      context: configuration(),
      termsDocument,
    },
    services: { purchase: { enabled: true }, lifecycle: { enabled: true } },
    execute: createPiggyvestPostgresExecutor(database()),
    createRlsClient: (request) => {
      const reader = authenticatedReader();
      const sessions = (request.headers.get('cookie') ?? '')
        .split(';')
        .map((value) => value.trim())
        .filter((value) => value.split('=')[0] === 'synthetic-session');
      if (sessions.length !== 1 || sessions[0] !== 'synthetic-session=owner') {
        reader.auth.getUser = async () => ({
          data: { user: null },
          error: new AuthError('Synthetic unauthenticated', 401),
        });
      }
      return Promise.resolve(reader);
    },
  });
  try {
    for (const cookie of [
      '',
      'synthetic-session=foreign',
      'synthetic-session=owner; synthetic-session=owner',
    ]) {
      expect(
        (
          await fetch(`${runtime.origin}/screen?goalId=${goalId}`, {
            headers: { cookie, origin: 'http://127.0.0.1:4184' },
          })
        ).status
      ).toBe(401);
    }
    const headers = {
      origin: 'http://127.0.0.1:4184',
      cookie: 'synthetic-session=owner',
    };
    const bootstrap = await fetch(`${runtime.origin}/csrf`, { headers });
    expect(bootstrap.status).toBe(200);
    const token = await bootstrap.json();
    const cookie = `${headers.cookie}; ${bootstrap.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')}`;
    const transport: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          origin: headers.origin,
          cookie,
        },
      });
    const call = (path: string, body: unknown) =>
      transport(`${runtime.origin}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': token.csrfToken,
        },
        body: JSON.stringify(body),
      });
    expect(
      (
        await call('/lifecycle/terms', {
          goalId,
          revisionId,
          durationMonths: 1,
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call('/policy', {
          goalId,
          revisionId,
          durationMonths: 1,
          accepted: true,
          termsVersion: termsDocument.version,
          termsHash: termsDocument.hash,
        })
      ).status
    ).toBe(200);
    await query(
      'piggyvest_staging_policy_writer',
      'SELECT goal_policy_test.purchase_credit(243,98000,98243)'
    );
    expect(
      (
        await call('/lifecycle/activate', {
          goalId,
          revisionId,
          operationId: goal(99243),
        })
      ).status
    ).toBe(200);
    await query(
      'harness_admin',
      `INSERT INTO piggyvest_purchase_pricing.capabilities(goal_id,revision_id,fee_policy_version,fee_kobo,tax_treatment,quote_seconds,enabled) VALUES($1,$2,'synthetic-explicit-fee-v1',50,'exclusive_device',300,true)`,
      [goalId, revisionId]
    );
    const sourceResponse = await transport(
      `${runtime.origin}/screen?goalId=${goalId}`
    );
    expect(sourceResponse.status).toBe(200);
    const source: unknown = await sourceResponse.json();
    const selection = {
      goalId,
      quoteId: goal(88243),
      shippingRateId: goal(8001),
      savingsKobo: 97000,
      fulfilmentMode: 'pickup',
    };
    return {
      runtime,
      source,
      selection,
      operationId: goal(97243),
      transport,
      getCsrfToken: async () => token.csrfToken,
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
