import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { createPiggyvestCustomerScheduleHandler } from './customer-schedule-handler';
import { scheduleLifecycleFixture } from './schedule-lifecycle.test-support';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

export function customerScheduleHandlerFixture() {
  const execute = vi.fn();
  const runtime = scheduleStoreRuntimeFixture(101, execute);
  const fixture = scheduleLifecycleFixture();
  const scope = {
    integrationId: runtime.options.configuration.integrationId,
    merchantId: runtime.options.configuration.merchantId,
    customerId: runtime.options.configuration.allowlistedCustomerIds[0],
    goalId: runtime.goalId,
  };
  const snapshot = {
    trusted: { ...fixture.trusted, scope, actorId: runtime.actorId },
    state: { ...fixture.state, scope },
    token: 'a'.repeat(32),
    historical: null,
  };
  execute.mockImplementation((statement: string, parameters: string[]) => {
    if (statement === SCHEDULE_STORE_STATEMENTS.readScheduleProposal.text)
      return Promise.resolve({ rows: [{ result: snapshot }] });
    const payload = JSON.parse(parameters[6]);
    return Promise.resolve({
      rows: [
        {
          result: {
            operationId: payload.operationId,
            state: payload.proposal,
            persisted: true,
            dispatch: 'disabled',
            debitPermission: false,
          },
        },
      ],
    });
  });
  const checkCsrfProtection = vi.fn().mockResolvedValue({ valid: true });
  const handler = createPiggyvestCustomerScheduleHandler({
    ...runtime.options,
    checkCsrfProtection,
  });
  const operationId = '80000000-0000-4000-8000-000000000101';
  const body = {
    operationId,
    command: { action: 'pause', goalId: runtime.goalId, expectedVersion: 0 },
  };
  function request(method = 'GET', value: unknown = body, query?: string) {
    return new NextRequest(
      `http://127.0.0.1:4179/schedule${query ?? (method === 'GET' ? `?goalId=${runtime.goalId}` : '')}`,
      {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(value) } : {}),
      }
    );
  }
  return {
    ...runtime,
    execute,
    snapshot,
    handler,
    checkCsrfProtection,
    request,
    body,
  };
}
