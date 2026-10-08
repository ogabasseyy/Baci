import { piggyvestPolicyReviewSchemas as policy } from '../contracts/piggyvest-policy-review';
import { piggyvestPolicyClientSchemas as schemas } from '../schemas/piggyvest-policy-client';
import { readPiggyvestPolicyClientBody } from './piggyvest-policy-client-body';

const REQUEST_TIMEOUT_MS = 5000;
type View = ReturnType<typeof policy.view.parse>;

export function createPiggyvestPolicyClient(options: {
  configuration: unknown;
  fetch: typeof globalThis.fetch;
  getCsrfToken: (signal: AbortSignal) => Promise<string>;
  isCurrent?: () => boolean;
}) {
  const parsed = schemas.configuration.safeParse(options.configuration);
  if (
    !parsed.success ||
    typeof options.fetch !== 'function' ||
    typeof options.getCsrfToken !== 'function' ||
    (options.isCurrent !== undefined && typeof options.isCurrent !== 'function')
  )
    throw new Error('Policy unavailable');
  const config = parsed.data;
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}${config.endpointPath}`;

  async function request(
    method: 'GET' | 'POST',
    input: unknown,
    signal?: AbortSignal
  ): Promise<View> {
    const controller = new AbortController();
    let response: Response | undefined;
    let complete = false;
    let interrupt: () => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      interrupt = () => {
        controller.abort();
        reject(new Error('Policy unavailable'));
      };
    });
    const timeout = setTimeout(interrupt, REQUEST_TIMEOUT_MS);
    signal?.addEventListener('abort', interrupt, { once: true });
    const assertCurrent = () => {
      if (
        signal?.aborted ||
        controller.signal.aborted ||
        (options.isCurrent && options.isCurrent() !== true)
      )
        throw new Error('Policy unavailable');
    };
    try {
      assertCurrent();
      const acceptance =
        method === 'POST' ? policy.acceptance.parse(input) : null;
      const goalId = (
        acceptance?.goalId ?? policy.acceptance.shape.goalId.parse(input)
      ).toLowerCase();
      const body = acceptance
        ? {
            ...acceptance,
            goalId,
            revisionId: acceptance.revisionId.toLowerCase(),
          }
        : null;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (body) {
        const token = await Promise.race([
          Promise.resolve().then(() => options.getCsrfToken(controller.signal)),
          interrupted,
        ]);
        assertCurrent();
        headers['Content-Type'] = 'application/json';
        headers['x-csrf-token'] = schemas.csrf.parse(token);
      }
      const url = body ? endpoint : `${endpoint}?goalId=${goalId}`;
      assertCurrent();
      const fetching = Promise.resolve().then(() => {
        assertCurrent();
        return options.fetch(url, {
          method,
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
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
        throw new Error('Policy unavailable');
      const received = policy.view.parse(
        await readPiggyvestPolicyClientBody(response, interrupted)
      );
      assertCurrent();
      const view: View =
        received.status === 'draft'
          ? {
              ...received,
              goalId: received.goalId.toLowerCase(),
              revisionId: received.revisionId.toLowerCase(),
            }
          : received;
      if (view.status === 'draft' && view.goalId !== goalId)
        throw new Error('Policy unavailable');
      if (
        body &&
        (view.status !== 'draft' ||
          view.consent !== 'accepted' ||
          view.revisionId !== body.revisionId ||
          view.durationMonths !== body.durationMonths ||
          view.terms.version !== body.termsVersion ||
          view.terms.hash !== body.termsHash)
      )
        throw new Error('Policy unavailable');
      complete = true;
      return view;
    } catch {
      throw new Error('Policy unavailable');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', interrupt);
      if (!complete) {
        controller.abort();
        if (response?.body && !response.body.locked)
          void response.body.cancel().catch(() => undefined);
      }
    }
  }
  return {
    load(goalId: unknown, signal?: AbortSignal): Promise<View> {
      return request('GET', goalId, signal);
    },
    submit(acceptance: unknown, signal?: AbortSignal): Promise<View> {
      return request('POST', acceptance, signal);
    },
  };
}
