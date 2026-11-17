import { chatwootProductLookupResponseSchema } from '@/schemas/chatwoot-product-card';
import { postChatwootBridgeJson } from './chatwoot-bridge-request';

const RESPONSE_EVENT = 'baci-product-response:';

export async function handleChatwootInlineProductLookup(input: {
  conversationId: number;
  isCurrentAction: () => boolean;
  post: (prefix: string, value: unknown) => void;
  requestId: string;
  sessionToken: string;
  slug: string;
  storeSlug: string;
}) {
  const value = await postChatwootBridgeJson(
    '/api/storefront/chatwoot/products',
    {
      conversationId: input.conversationId,
      requestId: input.requestId,
      sessionToken: input.sessionToken,
      slug: input.slug,
    },
    input.storeSlug,
    undefined,
    { allowNonOkResponse: true }
  );
  if (!input.isCurrentAction()) return;
  const responseBody = value ? { ...value } : value;
  if (responseBody) delete responseBody.httpStatus;
  const result = chatwootProductLookupResponseSchema.safeParse(responseBody);
  const uncorrelatedInvalidRequest =
    result.success &&
    !result.data.ok &&
    result.data.code === 'invalid_request' &&
    result.data.requestId === undefined;
  if (
    !result.success ||
    (result.data.requestId !== input.requestId && !uncorrelatedInvalidRequest)
  ) {
    input.post(RESPONSE_EVENT, {
      requestId: input.requestId,
      status: 'unavailable',
      code: 'product_unavailable',
    });
    return;
  }
  if (result.data.ok) {
    input.post(RESPONSE_EVENT, {
      requestId: input.requestId,
      status: 'available',
      product: result.data.product,
    });
    return;
  }
  input.post(RESPONSE_EVENT, {
    requestId: input.requestId,
    status: 'unavailable',
    code: result.data.code,
  });
}
