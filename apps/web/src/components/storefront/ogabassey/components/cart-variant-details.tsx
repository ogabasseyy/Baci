import { canonicalizeCommerceVariantAxis } from '@baci/shared/lib/commerce-variant-axis';
import { formatCanonicalProductConditionLabel } from '@baci/shared/lib/product-condition';

interface VariantDetailsItem {
  condition?: string;
  selectedColor?: string;
  selectedStorage?: string;
  secondaryColor?: string;
  variantAttributes?: Record<string, string>;
}

/** Render the saved SKU selection consistently in carts and checkout. */
export function CartVariantDetails({
  item,
  className = 'text-store-background-text/70',
}: {
  item: VariantDetailsItem;
  className?: string;
}) {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.variantAttributes ?? {})) {
    const axis = canonicalizeCommerceVariantAxis(key);
    if (axis && typeof value === 'string' && value.trim()) attributes[axis] = value.trim();
  }
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const condition = text(item.condition) || attributes.condition;
  const details = [
    ['Storage', attributes.storage || text(item.selectedStorage)],
    ['SIM type', attributes.sim_type],
    [
      'Condition',
      condition
        ? formatCanonicalProductConditionLabel(condition) || condition
        : undefined,
    ],
    ['Colour', attributes.color || text(item.selectedColor)],
    ...Object.entries(attributes)
      .filter(([axis]) => !['storage', 'sim_type', 'condition', 'color'].includes(axis))
      .map(([axis, value]) => [axis === 'ram' ? 'RAM' : axis.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()), value]),
    ['Second colour preference', text(item.secondaryColor)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (!details.length) return null;

  return (
    <dl
      aria-label="Selected variant"
      className={`mt-1 space-y-0.5 text-xs ${className}`}
    >
      {details.map(([label, value]) => (
        <div className="flex flex-wrap gap-x-1" key={label}>
          <dt>{label}:</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
