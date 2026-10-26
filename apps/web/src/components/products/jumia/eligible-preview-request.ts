import {
  type JumiaProductExportEligiblePage,
  jumiaProductExportEligiblePageSchema,
} from '@/schemas/jumia/eligible-page';
import {
  eligiblePreviewRequestTimeoutMs,
  jumiaPreviewMessages,
} from './constants';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';
import { requestDeadline } from './request-deadline';

async function requestErrorMessage(
  response: Response,
  fallback: string,
  signal?: AbortSignal
) {
  if (signal?.aborted) throw signal.reason;
  if (response.status !== 402) return fallback;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    if (signal?.aborted) throw signal.reason ?? cause;
    payload = null;
  }
  return gamingSelectionPreviewCache.isRecord(payload) &&
    payload.code === 'requires_upgrade'
    ? jumiaPreviewMessages.upgradeRequired
    : fallback;
}

function requestEligiblePreviewPage(
  merchantId: string,
  selectionId: string,
  page: number,
  lifecycleSignal?: AbortSignal
): Promise<JumiaProductExportEligiblePage> {
  return requestDeadline.run(
    async (signal) => {
      const response = await fetch(
        `/api/marketplace/jumia/products/eligible?${new URLSearchParams({ selectionId, merchantId, page: String(page) })}`,
        { signal }
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
        body = await response.json();
      } catch (cause) {
        if (signal.aborted) throw signal.reason ?? cause;
        throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
      }
      const parsed = jumiaProductExportEligiblePageSchema.safeParse(body);
      if (!parsed.success) {
        throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
      }
      if (
        parsed.data.selectionId !== selectionId ||
        parsed.data.page !== page
      ) {
        throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
      }
      return parsed.data;
    },
    {
      timeoutMs: eligiblePreviewRequestTimeoutMs,
      timeoutMessage: 'Eligible page request timed out.',
      parentSignal: lifecycleSignal,
    }
  );
}

export const eligiblePreviewRequest = {
  errorMessage: requestErrorMessage,
  page: requestEligiblePreviewPage,
};
