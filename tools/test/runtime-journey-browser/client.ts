import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import {
  createPiggyvestCancellationClientBinding,
  createPiggyvestPolicyClient,
  createPiggyvestPurchaseClient,
  createPiggyvestPurchaseController,
} from '@baci/shared/lib';
import { readPiggyvestPolicyClientBody } from '../../../packages/shared/src/lib/piggyvest-policy-client-body';
import { runtimeJourneyBrowserSchemas as schemas } from './schemas';

export function createRuntimeJourneyBrowserClient(options: {
  origin: unknown;
  scenario: unknown;
  fetch: typeof globalThis.fetch;
  isCurrent: () => boolean;
}) {
  const origin = schemas.origin.parse(options.origin);
  const scenario = schemas.scenario.parse(options.scenario);
  const path = scenario.pathPrefix;
  const check = () => {
    if (options.isCurrent() !== true) throw new Error('Local QA unavailable');
  };
  async function read(action: 'screen' | 'csrf' | 'qa-capability') {
    const abort = new AbortController();
    let response: Response | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error());
      }, 5000);
    });
    try {
      check();
      const url = `${origin}${path}/${action}${action === 'screen' ? `?goalId=${scenario.goalId}` : ''}`;
      const pending = options.fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        mode: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
        signal: abort.signal,
      });
      void pending
        .then((late) => {
          if (abort.signal.aborted && late.body && !late.body.locked)
            void late.body.cancel().catch(() => undefined);
        })
        .catch(() => undefined);
      response = await Promise.race([pending, interrupted]);
      if (!response.ok || response.redirected || response.url !== url)
        throw new Error();
      const value = await readPiggyvestPolicyClientBody(response, interrupted);
      check();
      return value;
    } catch {
      throw new Error('Local QA unavailable');
    } finally {
      clearTimeout(timer);
      abort.abort();
      if (response?.body && !response.body.locked)
        void response.body.cancel().catch(() => undefined);
    }
  }
  async function csrf() {
    try {
      const result = schemas.csrf.parse(await read('csrf'));
      if (result.expiresAt <= Date.now()) throw new Error();
      return result.csrfToken;
    } catch {
      throw new Error('Local QA unavailable');
    }
  }
  const policy = createPiggyvestPolicyClient({
    configuration: {
      mode: 'local_test',
      baseUrl: origin,
      endpointPath: `${path}/policy`,
      credentials: 'same-origin',
    },
    fetch: options.fetch,
    getCsrfToken: csrf,
    isCurrent: options.isCurrent,
  });
  return {
    csrf,
    async cancellationMode() {
      try {
        const capability = schemas.capability.parse(
          await read('qa-capability')
        );
        if (
          capability.goalId !== scenario.goalId ||
          capability.operationId !== scenario.operationId
        )
          throw new Error();
        return capability.mode;
      } catch {
        return 'recovery' as const;
      }
    },
    async screen() {
      try {
        const source = piggyvestSavingsScreenSchema.parse(await read('screen'));
        if (source.status === 'ready' && source.goalId !== scenario.goalId)
          throw new Error();
        return source;
      } catch {
        throw new Error('Local QA unavailable');
      }
    },
    submit: policy.submit,
    purchase(source: unknown, mode: 'prepare' | 'recovery') {
      if (!scenario.purchaseSelection || !scenario.operationId)
        throw new Error('Local QA unavailable');
      return createPiggyvestPurchaseController({
        source,
        mode,
        operationId: scenario.operationId,
        tenantKey: 'explicit-synthetic-tenant',
        isCurrent: options.isCurrent,
        client: createPiggyvestPurchaseClient({
          goalId: scenario.goalId,
          configuration: {
            mode: 'local_test',
            baseUrl: origin,
            endpointPath: `${path}/purchase`,
            credentials: 'same-origin',
          },
          fetch: options.fetch,
          isCurrent: options.isCurrent,
          getCsrfToken: csrf,
        }),
      });
    },
    cancellation(source: unknown, mode: 'prepare' | 'recovery') {
      return createPiggyvestCancellationClientBinding({
        mode,
        source,
        tenantKey: 'explicit-synthetic-tenant',
        operationId: scenario.operationId,
        isCurrent: () => options.isCurrent(),
        http: {
          configuration: {
            mode: 'local_test',
            baseUrl: origin,
            endpointPath: `${path}/cancel`,
            recoveryEndpointPath: `${path}/recovery`,
            credentials: 'same-origin',
          },
          fetch: options.fetch,
          getCsrfToken: csrf,
        },
      });
    },
  };
}
