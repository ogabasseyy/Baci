import { getComparisonReferenceSources } from '@/lib/storefront-compare/comparison-reference-sources';

interface CompareMethodologyProps {
  leftLabel: string;
  rightLabel: string;
  productSlugs: string[];
}

export function CompareMethodology({
  leftLabel,
  rightLabel,
  productSlugs,
}: CompareMethodologyProps) {
  const referenceSources = getComparisonReferenceSources(productSlugs);
  return (
    <>
      <section className="mt-8 rounded-2xl border border-store-border bg-store-background-text/5 p-5">
        <h2 className="text-xl font-semibold">How to use this comparison</h2>
        <div className="mt-3 space-y-3 text-sm text-store-background-text/70 sm:text-base">
          <p>
            Check the verdict first, then review the differences and table rows
            for {leftLabel} and {rightLabel}. Prioritize the specs, price range,
            condition, warranty and delivery details that affect how you plan to
            use this product category.
          </p>
          <p>
            Before checkout, confirm live availability, selected variant,
            regional compatibility and included accessories on the product page.
            Similar model names can hide different storage, platform, display or
            bundle details, so use the table as a shortlist before opening the
            final product listing.
          </p>
        </div>
      </section>

      <p className="mt-6 text-sm">
        Not documented means a fact is missing from this listing; it does not
        mean unsupported. No / Not supported and Not applicable are explicit
        catalog statements. This comparison compiles catalog specifications and
        current listing offers; it does not represent hands-on testing or
        independent manufacturer verification. Confirm exact model codes and
        configuration with the seller.
      </p>

      {referenceSources.length > 0 && (
        <section className="mt-8" aria-label="Manufacturer references">
          <h2 className="text-xl font-semibold">Manufacturer references</h2>
          <p className="mt-2 text-sm">
            Use these references to check the exact model and configuration.
            Listing specifications are supplied by the catalog and may require
            reconciliation; a reference link is not a certification of each
            table value.
          </p>
          <ul className="mt-3 space-y-2">
            {referenceSources.map((source) => (
              <li key={source.href}>
                <a className="text-store-primary underline" href={source.href}>
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
