import { buildProductContextSpecFacts } from './build-product-context-spec-facts';
import type {
  ProductSemanticCandidate,
  ProductSemanticModel,
  ProductSemanticSection,
} from './product-semantic-types';

const GAMING_CATEGORY_PATTERN =
  /(playstation|nintendo|xbox|gaming|vr|gift-card|gift-cards)/i;
const COMPUTER_CATEGORY_PATTERN = /(laptop|desktop|monitor|computer|tablet)/i;
const MOBILE_CATEGORY_PATTERN = /(smartphone|phone|watch|audio|soundbar|tv)/i;

interface BuildProductContextParagraphsInput {
  categoryName: string;
  categorySlug: string;
  currentProduct: ProductSemanticCandidate;
  displayPriceText?: string | null;
  merchantBusinessName: string;
  semanticModel?: Pick<
    ProductSemanticModel,
    'alternatives' | 'guideLinks' | 'sameBrand' | 'samePrice' | 'supportLinks'
  >;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCondition(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized
    ? normalized
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : null;
}

function buildCategoryChecklist(categorySlug: string, categoryName: string) {
  if (COMPUTER_CATEGORY_PATTERN.test(categorySlug)) {
    return `For ${categoryName} products, compare the processor or panel class, RAM and storage where applicable, port selection, included accessories, operating-system requirements, warranty terms and upgrade limits. Confirm the exact configuration shown on the retail box because laptop, desktop and monitor variants can share similar names while shipping with different specifications.`;
  }

  if (GAMING_CATEGORY_PATTERN.test(categorySlug)) {
    return `For ${categoryName} items, check the platform generation, disc, cartridge or digital-code format, region compatibility, age rating, storage or update requirements, and whether online multiplayer, DLC or subscriptions are needed. Accessories should also be checked against the exact console model and included cable or adapter requirements.`;
  }

  if (MOBILE_CATEGORY_PATTERN.test(categorySlug)) {
    return `For ${categoryName} products, confirm the exact model, color, storage or size option, network or device compatibility, charging requirements, included accessories and warranty terms. Audio, TV, phone and smartwatch variants can differ by region, so the final checkout selection should match the retail unit you intend to receive.`;
  }

  return `For ${categoryName} products, review the exact model, condition, variant, package contents, compatibility notes, warranty terms and delivery requirements before checkout. Category pages can contain similar-looking items, so the structured specs and selected options should be used to confirm the final retail unit.`;
}

function buildAvailabilitySentence(stock: number | null | undefined) {
  if (stock != null && stock <= 0) {
    return 'Availability should be rechecked because this item may currently be out of stock.';
  }

  return 'Live stock, selected options and delivery timing should still be confirmed at checkout.';
}

function hasSectionCards(section: ProductSemanticSection | null | undefined) {
  return Boolean(section?.cards.length);
}

function joinList(parts: string[]) {
  if (parts.length <= 1) {
    return parts[0] ?? '';
  }

  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function buildPricePhrase(displayPriceText: string | null | undefined) {
  const cleanPrice = normalizeText(displayPriceText);

  return cleanPrice
    ? `with pricing shown on this page as ${cleanPrice}`
    : 'with pricing shown on this page';
}

function buildComparisonSentence({
  categoryLabel,
  comparisonSubject,
  merchantName,
  productName,
  semanticModel,
}: {
  categoryLabel: string;
  comparisonSubject: string;
  merchantName: string;
  productName: string;
  semanticModel?: BuildProductContextParagraphsInput['semanticModel'];
}) {
  const renderedSections = [
    semanticModel?.supportLinks.length ? 'comparison links' : '',
    semanticModel?.guideLinks.length ? 'buyer guides' : '',
    hasSectionCards(semanticModel?.sameBrand) ? 'same-brand options' : '',
    hasSectionCards(semanticModel?.samePrice)
      ? 'similar-price alternatives'
      : '',
    hasSectionCards(semanticModel?.alternatives)
      ? `${categoryLabel.toLowerCase()} alternatives`
      : '',
  ].filter(Boolean);

  if (renderedSections.length === 0) {
    return `For buyers comparing ${comparisonSubject}, use the visible details on this page to compare ${productName} with relevant options from ${merchantName}.`;
  }

  return `For buyers comparing ${comparisonSubject}, use the ${joinList(
    renderedSections
  )} on this page to move from ${productName} to relevant options from ${merchantName}.`;
}

export function buildProductContextParagraphs({
  categoryName,
  categorySlug,
  currentProduct,
  displayPriceText,
  merchantBusinessName,
  semanticModel,
}: BuildProductContextParagraphsInput): string[] {
  const productName = normalizeText(currentProduct.name) ?? 'This product';
  const merchantName = normalizeText(merchantBusinessName) ?? 'this store';
  const categoryLabel = normalizeText(categoryName) ?? 'this category';
  const slugForChecklist = normalizeText(categorySlug) ?? categoryLabel;
  const brandName = normalizeText(currentProduct.brand);
  const condition = normalizeCondition(currentProduct.condition);
  const conditionPhrase = condition
    ? `${condition} condition`
    : 'the listed condition';
  const comparisonSubject = brandName
    ? `${brandName} options`
    : `${categoryLabel.toLowerCase()} alternatives`;
  const specClassificationCategory =
    normalizeText(categorySlug) ?? categoryLabel;
  const specFacts = buildProductContextSpecFacts(
    currentProduct.product_key_specs,
    specClassificationCategory
  );

  const paragraphs = [
    `${productName} is listed by ${merchantName} in ${categoryLabel}, ${buildPricePhrase(
      displayPriceText
    )}. Use this product page to review ${conditionPhrase}, compare the exact item details, and verify practical purchase details before checkout. ${buildAvailabilitySentence(
      currentProduct.stock
    )}`,
    `${buildComparisonSentence({
      categoryLabel,
      comparisonSubject,
      merchantName,
      productName,
      semanticModel,
    })} ${buildCategoryChecklist(slugForChecklist, categoryLabel)}`,
  ];

  if (specFacts.length > 0) {
    paragraphs.push(
      `The structured product details currently highlight ${specFacts.join(', ')}. Use these facts together with the product images, selected variant and checkout availability to confirm that this is the correct configuration for your device, console, workspace or entertainment setup.`
    );
  }

  return paragraphs;
}
