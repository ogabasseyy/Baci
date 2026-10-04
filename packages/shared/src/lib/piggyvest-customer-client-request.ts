import { piggyvestCustomerClientRequestSchema } from '../schemas/piggyvest-customer-client-request';
import { piggyvestPolicyClientSchemas } from '../schemas/piggyvest-policy-client';
import { readPiggyvestPolicyClientBody } from './piggyvest-policy-client-body';

export function createPiggyvestCustomerClientRequest(options: {
  configuration: unknown;
  fetch: typeof globalThis.fetch;
  getCsrfToken: (signal: AbortSignal) => Promise<string>;
  isCurrent: () => boolean;
}) {
  const config = piggyvestCustomerClientRequestSchema.parse(
    options.configuration
  );
  if (
    typeof options.fetch !== 'function' ||
    typeof options.getCsrfToken !== 'function' ||
    typeof options.isCurrent !== 'function'
  )
    throw new Error('Customer request unavailable');
  return async (
    input: {
      method: 'GET' | 'POST';
      endpointPath: string;
      query?: Record<string, string>;
      body?: unknown;
    },
    signal?: AbortSignal
  ): Promise<unknown> => {
    const controller = new AbortController();
    let response: Response | undefined;
    let complete = false;
    let interrupt: () => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      interrupt = () => {
        controller.abort();
        reject(new Error('Customer request unavailable'));
      };
    });
    const timeout = setTimeout(interrupt, 5000);
    signal?.addEventListener('abort', interrupt, { once: true });
    const assertCurrent = () => {
      if (
        signal?.aborted ||
        controller.signal.aborted ||
        options.isCurrent() !== true
      )
        throw new Error('Customer request unavailable');
    };
    try {
      assertCurrent();
      if (
        !config.endpointPaths.includes(input.endpointPath) ||
        !['GET', 'POST'].includes(input.method) ||
        (input.method === 'GET' && input.body !== undefined) ||
        (input.method === 'POST' && input.query !== undefined)
      )
        throw new Error('Customer request unavailable');
      const query = new URLSearchParams(input.query).toString();
      const url = `${config.baseUrl.replace(/\/$/, '')}${input.endpointPath}${query ? `?${query}` : ''}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (input.method === 'POST') {
        const token = await Promise.race([
          Promise.resolve().then(() => options.getCsrfToken(controller.signal)),
          interrupted,
        ]);
        assertCurrent();
        headers['Content-Type'] = 'application/json';
        headers['x-csrf-token'] =
          piggyvestPolicyClientSchemas.csrf.parse(token);
      }
      assertCurrent();
      const fetching = Promise.resolve().then(() => {
        assertCurrent();
        return options.fetch(url, {
          method: input.method,
          headers,
          ...(input.method === 'POST'
            ? { body: JSON.stringify(input.body) }
            : {}),
          signal: controller.signal,
          credentials: config.credentials,
          redirect: 'error',
          cache: 'no-store',
          mode: 'same-origin',
          referrerPolicy: 'no-referrer',
        });
      });
      void fetching
        .then((late) => {
          if (controller.signal.aborted && late.body && !late.body.locked)
            void late.body.cancel().catch(() => undefined);
        })
        .catch(() => undefined);
      response = await Promise.race([fetching, interrupted]);
      assertCurrent();
      if (
        response.status < 200 ||
        response.status >= 300 ||
        response.redirected ||
        response.url !== url
      )
        throw new Error('Customer request unavailable');
      const result = await readPiggyvestPolicyClientBody(response, interrupted);
      assertCurrent();
      complete = true;
      return result;
    } catch {
      throw new Error('Customer request unavailable');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', interrupt);
      if (!complete) {
        controller.abort();
        if (response?.body && !response.body.locked)
          void response.body.cancel().catch(() => undefined);
      }
    }
  };
}
