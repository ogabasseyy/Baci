import type {
  JumiaGamingDraftPage,
  JumiaGamingDraftProduct,
} from '@/schemas/jumia/selection-draft';
import type { JumiaMappingDraft } from './jumia-mapping-draft-types';

type Props = {
  merchantId: string;
  integrationId: string;
  page: JumiaGamingDraftPage;
  selectedDraft: Readonly<Record<string, JumiaGamingDraftProduct>>;
  mapping: JumiaMappingDraft | null;
};

export function buildJumiaPagePreflightRequest({
  merchantId,
  integrationId,
  page,
  selectedDraft,
  mapping,
}: Props) {
  const selectedCount = Object.keys(selectedDraft).length;
  const currentPageSelection = page.products.flatMap((item) => {
    const selected = selectedDraft[item.id];
    if (
      !selected ||
      !item.available ||
      item.currentSourceVersion !== item.capturedSourceVersion ||
      selected.capturedSourceVersion !== item.capturedSourceVersion ||
      selected.sourceCategoryId !== page.sourceCategoryId
    )
      return [];
    return [{ productId: item.id, sourceVersion: item.capturedSourceVersion }];
  });
  const sameDestination =
    mapping?.merchantId === merchantId &&
    mapping.integrationId === integrationId &&
    mapping.countryCode.toUpperCase() === 'NG';
  const bulletsValid =
    mapping !== null &&
    mapping.bullets.length >= 4 &&
    mapping.bullets.length <= 7 &&
    mapping.bullets.every((bullet) => bullet.trim().length > 0);
  const readyMapping = Boolean(
    mapping &&
      sameDestination &&
      mapping.categoryConfirmed &&
      bulletsValid &&
      mapping.businessClientCode &&
      mapping.category.code > 0 &&
      mapping.brand.code > 0
  );
  const requestBody =
    mapping && readyMapping && currentPageSelection.length > 0
      ? {
          merchantId,
          integrationId,
          businessClientCode: mapping.businessClientCode,
          selectionId: page.selectionId,
          sourceCategoryId: page.sourceCategoryId,
          sourcePage: { page: page.page, limit: page.limit },
          products: currentPageSelection,
          mappings: currentPageSelection.map(({ productId }) => ({
            productId,
            category: {
              code: mapping.category.code,
              name: mapping.category.name,
            },
            brand: { code: mapping.brand.code, name: mapping.brand.name },
            attributeSetId: mapping.attributeSetId,
            attributes: Object.fromEntries(
              Object.entries(mapping.attributes).filter(
                ([, value]) => value !== undefined
              )
            ),
            bullets: mapping.bullets,
            ...(mapping.variation ? { variation: mapping.variation } : {}),
            categoryConfirmed: true as const,
          })),
        }
      : null;

  return {
    selectedCount,
    currentPageSelection,
    sameDestination,
    bulletsValid,
    requestBody,
  };
}
