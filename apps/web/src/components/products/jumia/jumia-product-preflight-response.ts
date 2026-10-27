import {
  type JumiaProductPreflightRequest,
  jumiaProductPreflightResponseSchema,
} from '@/schemas/jumia/product-preflight';

export function getSafePreflightError(payload: unknown): string | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('error' in payload) ||
    typeof payload.error !== 'string'
  )
    return null;
  return payload.error;
}

export function validateJumiaPreflightResponse(
  payload: unknown,
  request: JumiaProductPreflightRequest
) {
  const parsed = jumiaProductPreflightResponseSchema.safeParse(payload);
  if (!parsed.success)
    return {
      success: false as const,
      error: 'The preflight response could not be validated.',
    };

  const expectedIds = request.products.map((product) => product.productId);
  const matchesScope =
    parsed.data.scope.selectionId === request.selectionId &&
    parsed.data.scope.sourceCategoryId === request.sourceCategoryId &&
    parsed.data.scope.sourcePage.page === request.sourcePage.page &&
    parsed.data.scope.sourcePage.limit === request.sourcePage.limit &&
    parsed.data.scope.productIds.length === expectedIds.length &&
    parsed.data.scope.productIds.every(
      (productId, index) => productId === expectedIds[index]
    ) &&
    parsed.data.products.length === request.products.length &&
    parsed.data.products.every(
      (product, index) =>
        product.productId === request.products[index].productId &&
        product.sourceVersion === request.products[index].sourceVersion
    );
  if (!matchesScope)
    return {
      success: false as const,
      error: 'The preflight response did not match this selected page.',
    };

  return { success: true as const, result: parsed.data };
}
