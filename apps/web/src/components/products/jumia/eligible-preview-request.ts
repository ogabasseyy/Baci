import {
  type JumiaProductExportEligiblePage,
  jumiaProductExportEligiblePageSchema,
} from '@/schemas/jumia/eligible-page';
import { jumiaPreviewMessages } from './constants';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

async function requestErrorMessage(response: Response, fallback: string) {
  if (response.status !== 402) return fallback;
  const payload: unknown = await response.json().catch(() => null);
  return gamingSelectionPreviewCache.isRecord(payload) &&
    payload.code === 'requires_upgrade'
    ? jumiaPreviewMessages.upgradeRequired
    : fallback;
}

async function requestEligiblePreviewPage(
  selectionId: string,
  page: number
): Promise<JumiaProductExportEligiblePage> {
  const response = await fetch(
    `/api/marketplace/jumia/products/eligible?${new URLSearchParams({ selectionId, page: String(page) })}`
  );
  if (!response.ok) {
    throw gamingSelectionPreviewCache.makeRequestError(
      response.status,
      await requestErrorMessage(
        response,
        'Unable to load this Gaming preview. Please retry.'
      )
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
  }
  const parsed = jumiaProductExportEligiblePageSchema.safeParse(body);
  if (!parsed.success) {
    throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
  }
  if (parsed.data.selectionId !== selectionId) {
    throw gamingSelectionPreviewCache.makeInvalidPageResponseError();
  }
  return parsed.data;
}

export const eligiblePreviewRequest = {
  errorMessage: requestErrorMessage,
  page: requestEligiblePreviewPage,
};
