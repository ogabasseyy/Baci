import { isUnsupportedSpecValue } from '@/lib/storefront-specs/is-unsupported-spec-value';
import type { ProductSpecItem } from '@/lib/storefront-specs/spec-data';

// Configuration-specific values belong to the live variant selectors, not
// static model highlights. The complete normalized spec table remains below.
const CONFIGURATION_FACT =
  /\b(ram|memory|storage|capacity|colou?r|condition|model number)\b/i;

function priority(label: string) {
  const index = [
    /screen size|^display$/i,
    /processor|^cpu$/i,
    /battery/i,
    /camera/i,
  ].findIndex((pattern) => pattern.test(label));
  return index < 0 ? 4 : index;
}

export function ProductDesignHighlights({
  specs,
}: {
  specs: ProductSpecItem[];
}) {
  const highlights = specs
    .filter(
      ({ label, value }) =>
        value.trim() &&
        !isUnsupportedSpecValue(value) &&
        !/\b(confirm|do not|does not publish|not published|most listed|scalar fields)\b/i.test(
          value
        ) &&
        !/policy/i.test(label) &&
        (/^battery/i.test(label) || !CONFIGURATION_FACT.test(label.trim()))
    )
    .sort((a, b) => priority(a.label) - priority(b.label))
    .filter(
      (item, index, items) =>
        items.findIndex(
          (other) => other.label.toLowerCase() === item.label.toLowerCase()
        ) === index
    )
    .slice(0, 4);
  if (!highlights.length) return null;

  return (
    <section data-ogabassey-pdp-highlights aria-label="Product highlights">
      <p data-ogabassey-pdp-editorial-eyebrow>
        The details that make a difference
      </p>
      <dl>
        {highlights.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
