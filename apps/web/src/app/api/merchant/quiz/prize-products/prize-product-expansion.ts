import type {
  QuizPrizeProduct,
  QuizPrizeProductRow,
  QuizPrizeVariantRow,
} from '@/schemas/quiz-prize-product';
import { mapBaseProduct, mapVariantProduct } from './prize-product-mapping';

export function expandPrizeProduct(
  product: QuizPrizeProductRow,
  variants: QuizPrizeVariantRow[]
): QuizPrizeProduct[] {
  if (product.has_variants !== true) return [mapBaseProduct(product)];
  return [...variants]
    .sort(
      (left, right) =>
        (left.created_at ?? '').localeCompare(right.created_at ?? '') ||
        left.id.localeCompare(right.id)
    )
    .map((variant) => mapVariantProduct(product, variant));
}
