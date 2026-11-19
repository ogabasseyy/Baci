import { jumiaPreviewMessages } from './constants';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

type PreviewCallbacks = {
  loadPage: (selectionId: string) => Promise<void>;
  merchantId: string;
  generation: number;
  setError: (
    merchantId: string,
    generation: number,
    error: string | null
  ) => void;
  setLoading: (
    merchantId: string,
    generation: number,
    loading: boolean
  ) => void;
};

export async function recoverKnownSuccessfulPreview({
  loadPage,
  merchantId,
  generation,
  setError,
  setLoading,
}: PreviewCallbacks): Promise<'loaded' | 'missing' | 'failed'> {
  if (!gamingSelectionPreviewCache.findKnownSuccessfulSelection(merchantId)) {
    return 'missing';
  }
  setLoading(merchantId, generation, true);
  setError(merchantId, generation, null);
  try {
    return (await gamingSelectionPreviewCache.loadKnownSuccessfulSelection(
      merchantId,
      loadPage
    ))
      ? 'loaded'
      : 'missing';
  } catch (cause) {
    setError(
      merchantId,
      generation,
      gamingSelectionPreviewCache.errorMessage(
        cause,
        jumiaPreviewMessages.unreadableCreation
      )
    );
    return 'failed';
  } finally {
    setLoading(merchantId, generation, false);
  }
}
