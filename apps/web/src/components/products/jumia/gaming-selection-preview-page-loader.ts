import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { eligiblePreviewRequest } from './eligible-preview-request';

type PageOwnerCheck = (merchantId: string, generation: number) => boolean;
type SnapshotUpdater = (
  merchantId: string,
  generation: number,
  page: JumiaProductExportEligiblePage
) => void;

export function createGamingPreviewPageLoader(
  isCurrentMerchant: PageOwnerCheck,
  setSnapshotForMerchant: SnapshotUpdater
) {
  return async (
    merchantId: string,
    generation: number,
    selectionId: string,
    page: number,
    signal: AbortSignal
  ) => {
    if (signal.aborted) throw signal.reason;
    const result = await eligiblePreviewRequest.page(
      merchantId,
      selectionId,
      page,
      signal
    );
    if (!isCurrentMerchant(merchantId, generation)) {
      throw new Error('Gaming preview merchant changed while loading.');
    }
    setSnapshotForMerchant(merchantId, generation, result);
  };
}
