import type { ProductSpecSection } from '@/components/storefront/ogabassey/types';
import { ProductDesignHighlights } from './product-design-highlights';

interface OgabasseyPdpServerPrimaryDetailsProps {
  detailedSpecs: ProductSpecSection[];
  productName: string;
}

function getRenderableSpecSections(detailedSpecs: ProductSpecSection[]) {
  return detailedSpecs.flatMap((section) => {
    const category =
      typeof section.category === 'string' && section.category.trim()
        ? section.category.trim()
        : 'General';
    const items = Array.isArray(section.items)
      ? section.items
          .map((item) => {
            const record =
              item && typeof item === 'object'
                ? (item as Partial<ProductSpecSection['items'][number]>)
                : {};

            return {
              label:
                typeof record.label === 'string' ? record.label.trim() : '',
              value:
                typeof record.value === 'string' ? record.value.trim() : '',
            };
          })
          .filter((item) => item.label && item.value)
      : [];

    return items.length > 0 ? [{ category, items }] : [];
  });
}

function getSpecHeadingId(category: string, index: number) {
  const normalizedCategory = category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `ogabassey-pdp-server-spec-${normalizedCategory || 'section'}-${index}`;
}

export function OgabasseyPdpServerPrimaryDetails({
  detailedSpecs,
  productName,
}: OgabasseyPdpServerPrimaryDetailsProps) {
  const specSections = getRenderableSpecSections(detailedSpecs);
  if (specSections.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={`${productName} overview and specifications`}
      data-ogabassey-pdp-server-details
    >
      <ProductDesignHighlights
        specs={specSections.flatMap((section) => section.items)}
      />
      {specSections.length > 0 ? (
        <div data-ogabassey-pdp-server-details-card>
          <p data-ogabassey-pdp-server-details-eyebrow>Technical details</p>
          <h2
            id="ogabassey-pdp-server-specifications-title"
            data-ogabassey-pdp-server-details-title
          >
            Specifications
          </h2>
          <div data-ogabassey-pdp-server-spec-grid>
            {specSections.map((section, index) => {
              const headingId = getSpecHeadingId(section.category, index);

              return (
                <section
                  key={headingId}
                  aria-labelledby={headingId}
                  data-ogabassey-pdp-server-spec-section
                >
                  <h3 id={headingId} data-ogabassey-pdp-server-spec-heading>
                    {section.category}
                  </h3>
                  <dl data-ogabassey-pdp-server-spec-list>
                    {section.items.map((item) => (
                      <div
                        key={`${section.category}-${item.label}-${item.value}`}
                        data-ogabassey-pdp-server-spec-row
                      >
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
