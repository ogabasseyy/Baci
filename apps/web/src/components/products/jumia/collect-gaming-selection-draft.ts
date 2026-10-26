import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import {
  type JumiaGamingDraftPage,
  type JumiaGamingDraftProduct,
  jumiaGamingDraftPageSchema,
} from '@/schemas/jumia/selection-draft';
import { eligiblePreviewRequest } from './eligible-preview-request';

export async function collectGamingSelectionDraft(
  merchantId: string,
  snapshot: JumiaProductExportEligiblePage,
  signal: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
  onObservedPage?: (page: JumiaGamingDraftPage) => void
) {
  const initial = jumiaGamingDraftPageSchema.parse(snapshot);
  const products: JumiaGamingDraftProduct[] = [];
  const ineligibleIds: string[] = [];
  const seen = new Set<string>();
  for (let number = 1; number <= Math.max(1, initial.totalPages); number++) {
    signal.throwIfAborted();
    const response = await eligiblePreviewRequest.page(
      merchantId,
      initial.selectionId,
      number,
      signal
    );
    signal.throwIfAborted();
    const page = jumiaGamingDraftPageSchema.parse(response);
    if (
      page.selectionId !== initial.selectionId ||
      page.page !== number ||
      page.sourceCategoryId !== initial.sourceCategoryId ||
      page.total !== initial.total ||
      page.totalPages !== initial.totalPages ||
      page.limit !== initial.limit
    ) {
      throw new Error('Frozen selection changed while reading pages.');
    }
    // Observations can invalidate existing evidence even if later membership reads fail.
    onObservedPage?.(page);
    if (
      number === initial.page &&
      page.products.some(
        (item, index) =>
          item.id !== initial.products[index]?.id ||
          item.capturedSourceVersion !==
            initial.products[index]?.capturedSourceVersion
      )
    ) {
      throw new Error('Captured membership changed while reading pages.');
    }
    for (const item of page.products) {
      if (seen.has(item.id)) throw new Error('Duplicate frozen membership.');
      seen.add(item.id);
      if (
        !item.available ||
        item.capturedSourceVersion !== item.currentSourceVersion
      ) {
        ineligibleIds.push(item.id);
      } else {
        products.push({
          id: item.id,
          sourceCategoryId: page.sourceCategoryId,
          capturedSourceVersion: item.capturedSourceVersion,
        });
      }
    }
    onProgress?.(number, Math.max(1, initial.totalPages));
  }
  signal.throwIfAborted();
  if (seen.size !== initial.total)
    throw new Error('Incomplete frozen membership.');
  return { products, ineligibleIds };
}
