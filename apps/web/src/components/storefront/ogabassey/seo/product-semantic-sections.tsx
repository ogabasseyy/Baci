import type { ProductSemanticModel } from '@/lib/storefront-product/product-semantic-types';
import type { CompareLinkGraphEntry } from '@/lib/storefront-link-modules/compare-link-graph';
import { CategoryHubCardGrid } from './category-hub-card-grid';
import { CommercialSupportLinks } from './commercial-support-links';
import { ProductCompareLinks } from './product-compare-links';

interface ProductSemanticSectionsProps {
  model: ProductSemanticModel;
  merchantName?: string;
  productCompareLinks?: CompareLinkGraphEntry[];
  productComparePathPrefix?: string;
  productName?: string;
}

export function ProductSemanticSections({
  merchantName = 'this store',
  model,
  productCompareLinks = [],
  productComparePathPrefix = '',
  productName,
}: ProductSemanticSectionsProps) {
  const contextParagraphs = model.contextParagraphs ?? [];
  const hasCards = Boolean(
    model.alternatives || model.sameBrand || model.samePrice,
  );
  const hasContext = contextParagraphs.length > 0;
  const hasGuideLinks = model.guideLinks.length > 0;
  const productCompareProductName = productName || '';
  const hasProductCompareLinks =
    productCompareProductName.length > 0 && productCompareLinks.length > 0;

  if (
    !model.supportLinks.length &&
    !hasContext &&
    !hasGuideLinks &&
    !hasCards &&
    !hasProductCompareLinks
  ) {
    return null;
  }

  return (
    <section className="ogabassey-pdp-semantic-sections">
      {hasContext ? (
        <section
          aria-labelledby="product-details-buying-checklist"
          className="ogabassey-pdp-semantic-card"
        >
          <h2
            id="product-details-buying-checklist"
            className="ogabassey-pdp-semantic-card__title"
          >
            Product details and buying checklist
          </h2>
          {contextParagraphs.map((paragraph, index) => (
            <p
              key={index}
              className="ogabassey-pdp-semantic-card__description"
            >
              {paragraph}
            </p>
          ))}
        </section>
      ) : null}

      {hasGuideLinks ? (
        <section
          aria-labelledby="product-guide-links"
          className="ogabassey-pdp-semantic-card"
        >
          <h2
            id="product-guide-links"
            className="ogabassey-pdp-semantic-card__title"
          >
            Buyer guides
          </h2>
          <ul className="ogabassey-pdp-semantic-card__link-list">
            {model.guideLinks.map((link) => (
              <li key={link.href}>
                <a
                  className="ogabassey-pdp-semantic-card__link"
                  href={link.href}
                >
                  {link.title}
                </a>
                <p className="ogabassey-pdp-semantic-card__description">
                  {link.description}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {model.alternatives ? (
        <CategoryHubCardGrid
          title={model.alternatives.heading}
          cards={model.alternatives.cards}
        />
      ) : null}

      {model.sameBrand ? (
        <CategoryHubCardGrid
          title={model.sameBrand.heading}
          cards={model.sameBrand.cards}
        />
      ) : null}

      {model.samePrice ? (
        <CategoryHubCardGrid
          title={model.samePrice.heading}
          cards={model.samePrice.cards}
        />
      ) : null}

      {hasProductCompareLinks ? (
        <ProductCompareLinks
          links={productCompareLinks}
          merchantName={merchantName}
          pathPrefix={productComparePathPrefix}
          productName={productCompareProductName}
        />
      ) : null}

      <CommercialSupportLinks
        heading="Compare and Buying Guides"
        links={model.supportLinks}
      />
    </section>
  );
}
