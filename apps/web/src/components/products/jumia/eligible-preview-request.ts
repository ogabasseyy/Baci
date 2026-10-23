import {
  type JumiaProductExportEligiblePage,
  jumiaProductExportEligiblePageSchema,
} from '@/schemas/jumia/eligible-page';
import {
  eligiblePreviewRequestTimeoutMs,
  jumiaPreviewMessages,
} from './constants';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

function abortReason(signal: AbortSignal, cause: unknown) {
  return signal.reason ?? cause;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const observedPromise = Promise.resolve(promise);
  if (signal.aborted) {
    observedPromise.catch(() => undefined);
    return Promise.reject(abortReason(signal, undefined));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal, undefined));
    signal.addEventListener('abort', onAbort, { once: true });
    observedPromise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function requestErrorMessage(
  response: Response,
  fallback: string,
  signal?: AbortSignal
) {
  if (signal?.aborted) throw abortReason(signal, undefined);
  if (response.status !== 402) return fallback;
  let payload: unknown;
  try {
    const body = response.json();
    payload = signal ? await abortable(body, signal) : await body;
  } catch (cause) {
    if (signal?.aborted) throw abortReason(signal, cause);
    payload = null;
  }
  return gamingSelectionPreviewCache.isRecord(payload) &&
    payload.code === 'requires_upgrade'
    ? jumiaPreviewMessages.upgradeRequired
    : fallback;
}

async function requestEligiblePreviewPage(
  merchantId: string,
  selectionId: string,
  page: number,
  lifecycleSignal?: AbortSignal
): Promise<JumiaProductExportEligiblePage> {
  const controller = new AbortController();
  const abortFromLifecycle = () => controller.abort(lifecycleSignal?.reason);
  if (lifecycleSignal?.aborted) abortFromLifecycle();
  else
    lifecycleSignal?.addEventListener('abort', abortFromLifecycle, {
      once: true,
    });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException('Eligible page request timed out.', 'TimeoutError')
      ),
    eligiblePreviewRequestTimeoutMs
  );
  try {
    const signal = controller.signal;
    if (signal.aborted) throw abortReason(signal, undefined);
    const response = await abortable(
      Promise.resolve(
        fetch(
          `/api/marketplace/jumia/products/eligible?${new URLSearchParams({ selectionId, merchantId, page: String(page) })}`,
          { signal }
        )
      ),
      signal
    );
    if (!response.ok) {
      throw gamingSelectionPreviewCache.makeRequestError(
        response.status,
        await requestErrorMessage(
          response,
          'Unable to load this Gaming preview. Please retry.',
          signal
        )
      );
    }
    let body: unknown;
    try {
      if (signal.aborted) throw abortReason(signal, undefined);
      body = await abortable(response.json(), signal);
    } catch (cause) {
      if (signal.aborted) throw abortReason(signal, cause);
      throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
    }
    const parsed = jumiaProductExportEligiblePageSchema.safeParse(body);
    if (!parsed.success) {
      throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
    }
    if (parsed.data.selectionId !== selectionId || parsed.data.page !== page) {
      throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
    }
    return parsed.data;
  } catch (cause) {
    if (controller.signal.aborted) throw abortReason(controller.signal, cause);
    throw cause;
  } finally {
    clearTimeout(timeout);
    lifecycleSignal?.removeEventListener('abort', abortFromLifecycle);
  }
}

export const eligiblePreviewRequest = {
  errorMessage: requestErrorMessage,
  page: requestEligiblePreviewPage,
};
