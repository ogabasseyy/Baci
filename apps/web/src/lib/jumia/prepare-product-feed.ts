import { checkJumiaPreflightContent } from './prepare-product-feed-content-checks';
import { buildJumiaProductFamilyRecords } from './prepare-product-feed-records';
import { checkJumiaPreflightSource } from './prepare-product-feed-source-checks';
import type {
  JumiaCanonicalPreflightError,
  JumiaCanonicalPreflightInput,
  JumiaCanonicalPreflightResult,
} from './prepare-product-feed-types';

export type {
  CanonicalImage,
  CanonicalProduct,
  CanonicalVariant,
  JumiaCanonicalPreflightError,
  JumiaCanonicalPreflightInput,
  JumiaCanonicalPreflightResult,
} from './prepare-product-feed-types';

export function prepareJumiaProductFeed(
  input: JumiaCanonicalPreflightInput
): JumiaCanonicalPreflightResult {
  const errors: JumiaCanonicalPreflightError[] = [];
  const productId = input.source.product.id;
  const add = (field: string, code: string, variantId?: string) => {
    if (
      !errors.some(
        (error) =>
          error.field === field &&
          error.code === code &&
          error.variantId === variantId
      )
    )
      errors.push({
        productId,
        ...(variantId ? { variantId } : {}),
        field,
        code,
      });
  };
  const failure = (): JumiaCanonicalPreflightResult => ({
    success: false,
    products: [],
    errors: [...errors].sort((left, right) => {
      const leftKey = `${left.productId}\0${left.variantId ?? ''}\0${left.field}\0${left.code}`;
      const rightKey = `${right.productId}\0${right.variantId ?? ''}\0${right.field}\0${right.code}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  });

  const contentContext = checkJumiaPreflightContent(input, add);
  const sourceContext = checkJumiaPreflightSource(input, add);
  const records = buildJumiaProductFamilyRecords(
    input,
    {
      content: contentContext.contentResult.success
        ? contentContext.contentResult.content
        : null,
      price: contentContext.price,
      ...sourceContext,
    },
    add,
    () => errors.length > 0
  );
  if (
    errors.length ||
    records.length !== Math.max(sourceContext.orderedVariants.length, 1)
  )
    return failure();

  const skuSet = new Set<string>();
  for (const record of records) {
    if (skuSet.has(record.sellerSku))
      add(`source.sku.${record.sellerSku}`, 'duplicate_seller_sku');
    skuSet.add(record.sellerSku);
  }
  if (errors.length) return failure();

  return {
    success: true,
    products: structuredClone(records),
    families: [
      {
        familyKey: `${input.selectionId}:${productId}`,
        businessClientCode: input.destination.businessClientCode,
        categoryCode: input.mapping.category.code,
        attributeSetId: input.mapping.category.attributeSetId,
        records: structuredClone(records),
      },
    ],
    evidenceBoundaries: [
      'Local canonical validation only; not provider acceptance or permission to submit.',
      'Global price and image quality evidence must be independently established by the authorized server loader.',
    ],
  };
}
