import { fetchWithCsrf } from '@/lib/api-client';
import { jumiaProductExportSelectionCreateResponseSchema } from '@/schemas/jumia/product-export-selection-create-response';
import {
  jumiaPreviewMessages,
  selectionCreationRequestTimeoutMs,
} from './constants';
import { eligiblePreviewRequest } from './eligible-preview-request';
import { requestDeadline } from './request-deadline';

export class UnreadableSelectionCreationError extends Error {
  constructor() {
    super(jumiaPreviewMessages.unreadableCreation);
  }
}

export async function createGamingSelection(
  merchantId: string,
  categoryId: string
) {
  try {
    return await requestDeadline.run(
      async (signal) => {
        let response: Response;
        try {
          response = await fetchWithCsrf(
            '/api/marketplace/jumia/products/selections',
            {
              method: 'POST',
              body: JSON.stringify({
                sourceCategoryId: categoryId,
                merchantId,
              }),
              signal,
            }
          );
        } catch {
          throw new UnreadableSelectionCreationError();
        }
        if (!response.ok) {
          if (response.status >= 500) {
            throw new UnreadableSelectionCreationError();
          }
          throw new Error(
            await eligiblePreviewRequest.errorMessage(
              response,
              'Unable to create a Gaming preview. Please retry.',
              signal
            )
          );
        }
        let result: unknown;
        try {
          result = await response.json();
        } catch (cause) {
          if (signal.aborted) throw signal.reason ?? cause;
          throw new UnreadableSelectionCreationError();
        }
        const parsed =
          jumiaProductExportSelectionCreateResponseSchema.safeParse(result);
        if (!parsed.success) throw new UnreadableSelectionCreationError();
        return parsed.data;
      },
      {
        timeoutMs: selectionCreationRequestTimeoutMs,
        timeoutMessage: 'Gaming preview creation request timed out.',
      }
    );
  } catch (cause) {
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'name' in cause &&
      (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    ) {
      throw new UnreadableSelectionCreationError();
    }
    throw cause;
  }
}
