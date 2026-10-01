import { logger } from '@/lib/logger';

export type AbortableQuery<T> = PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<T>;
};

export interface StorefrontPdpSemanticRpcOptions {
  deadlineMs: number;
  traceThresholdMs: number;
}

export type StorefrontPdpSemanticBoundaryTrace = {
  elapsedMs: number;
  errorCode?: string;
  errorName?: string;
  outcome: 'slow_response' | 'throw' | 'timeout_response';
  responseStatus?: number;
};

export interface StorefrontPdpSemanticRpcResult<T> {
  response: T;
  trace: (
    fields: Omit<StorefrontPdpSemanticBoundaryTrace, 'elapsedMs'>
  ) => void;
}

function readStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const fieldValue = Reflect.get(value, field);
  return typeof fieldValue === 'string' ? fieldValue : undefined;
}

function readNumberField(value: unknown, field: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const fieldValue = Reflect.get(value, field);
  return typeof fieldValue === 'number' ? fieldValue : undefined;
}

function createAbortDeadlinePromise(signal: AbortSignal) {
  let cleanup: () => void = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    const onAbort = () => {
      cleanup();
      reject(
        signal.reason ??
          new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError'
          )
      );
    };

    cleanup = () => signal.removeEventListener('abort', onAbort);
    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });

  return { cleanup, promise };
}

/** Runs one bounded PDP semantic RPC and traces only slow/failed boundaries. */
export async function runStorefrontPdpSemanticRpc<T>(
  query: AbortableQuery<T>,
  options: StorefrontPdpSemanticRpcOptions
): Promise<StorefrontPdpSemanticRpcResult<T>> {
  const timeoutSignal = AbortSignal.timeout(options.deadlineMs);
  const boundedQuery =
    typeof query.abortSignal === 'function'
      ? query.abortSignal(timeoutSignal)
      : query;
  const deadline = createAbortDeadlinePromise(timeoutSignal);
  const startedAt = performance.now();
  const trace = (
    fields: Omit<StorefrontPdpSemanticBoundaryTrace, 'elapsedMs'>
  ) => {
    logger.warn({
      message: 'Storefront PDP semantic RPC boundary trace',
      operation: 'pdp_semantic_enrichment',
      ...fields,
      elapsedMs: Math.round(performance.now() - startedAt),
      deadlineMs: options.deadlineMs,
      timeoutSignalAborted: timeoutSignal.aborted,
    });
  };

  let response: T;
  try {
    // Some fetch implementations resolve an aborted PostgREST request well
    // after the signal fires. Race the response as well as aborting the
    // transport so the optional PDP work cannot extend the route deadline.
    response = await Promise.race([boundedQuery, deadline.promise]);
  } catch (error) {
    trace({
      errorCode: readStringField(error, 'code'),
      errorName: readStringField(error, 'name'),
      outcome: 'throw',
    });
    throw error;
  } finally {
    deadline.cleanup();
  }

  const elapsedMs = performance.now() - startedAt;
  const responseError =
    response && typeof response === 'object'
      ? Reflect.get(response, 'error')
      : null;
  if (elapsedMs >= options.traceThresholdMs && !responseError) {
    trace({
      outcome: 'slow_response',
      responseStatus: readNumberField(response, 'status'),
    });
  }

  return {
    response,
    trace,
  };
}
