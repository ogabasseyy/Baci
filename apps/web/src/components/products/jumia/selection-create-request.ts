import { fetchWithCsrf } from '@/lib/api-client';
import { jumiaProductExportSelectionCreateResponseSchema } from '@/schemas/jumia/product-export-selection-create-response';
import { jumiaPreviewMessages } from './constants';
import { eligiblePreviewRequest } from './eligible-preview-request';

export class UnreadableSelectionCreationError extends Error {
  constructor() {
    super(jumiaPreviewMessages.unreadableCreation);
  }
}

export async function createGamingSelection(
  merchantId: string,
  categoryId: string
) {
  let response: Response;
  try {
    response = await fetchWithCsrf(
      '/api/marketplace/jumia/products/selections',
      {
        method: 'POST',
        body: JSON.stringify({ sourceCategoryId: categoryId, merchantId }),
      }
    );
  } catch {
    throw new UnreadableSelectionCreationError();
  }
  if (!response.ok) {
    if (response.status >= 500) throw new UnreadableSelectionCreationError();
    throw new Error(
      await eligiblePreviewRequest.errorMessage(
        response,
        'Unable to create a Gaming preview. Please retry.'
      )
    );
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new UnreadableSelectionCreationError();
  }
  const parsed =
    jumiaProductExportSelectionCreateResponseSchema.safeParse(result);
  if (!parsed.success) throw new UnreadableSelectionCreationError();
  return parsed.data;
}
