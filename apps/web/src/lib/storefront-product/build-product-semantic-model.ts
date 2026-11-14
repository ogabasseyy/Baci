import { buildProductContextParagraphs } from './build-product-context-paragraphs';
import { buildProductGuideLinks } from './build-product-guide-links';
import {
  buildRecommendationSections,
  MAX_SEMANTIC_SECTION_CARDS,
} from './build-product-recommendation-sections';
import { buildProductSemanticCompareSupport } from './build-product-semantic-compare-support';
import { buildProductTrustBullets } from './build-product-trust-bullets';
import type {
  BuildProductSemanticModelInput,
  ProductSemanticModel,
} from './product-semantic-types';

export { MAX_SEMANTIC_SECTION_CARDS };

export function buildProductSemanticModel(
  input: BuildProductSemanticModelInput
): ProductSemanticModel {
  const {
    approvedCompareSlugs,
    input: normalizedInput,
    supportLinks,
  } = buildProductSemanticCompareSupport(input);
  const { alternatives, sameBrand, samePrice } = buildRecommendationSections(
    normalizedInput,
    approvedCompareSlugs
  );

  return {
    contextParagraphs: buildProductContextParagraphs(normalizedInput),
    trustBullets: buildProductTrustBullets(normalizedInput),
    supportLinks,
    guideLinks: buildProductGuideLinks(normalizedInput),
    alternatives,
    sameBrand,
    samePrice,
  };
}
