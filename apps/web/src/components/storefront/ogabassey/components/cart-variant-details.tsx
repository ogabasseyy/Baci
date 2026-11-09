import { canonicalizeCommerceVariantAxis } from '@baci/shared/lib/commerce-variant-axis';
import { formatCanonicalProductConditionLabel } from '@baci/shared/lib/product-condition';
import {
  resolveCartColorChipStyle,
  type VariantDetailsItem,
} from './cart-item-badge-style';

/** Render the saved SKU selection consistently in carts and checkout. */
export function CartVariantDetails({
  item,
  className = 'text-store-background-text/70',
  presentation = 'list',
}: {
  item: VariantDetailsItem;
  className?: string;
  presentation?: 'list' | 'chips';
}) {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.variantAttributes ?? {})) {
    const axis = canonicalizeCommerceVariantAxis(key);
    if (axis && typeof value === 'string' && value.trim())
      attributes[axis] = value.trim();
  }
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const condition = text(item.condition) || attributes.condition;
  const conditionLabel = condition
    ? formatCanonicalProductConditionLabel(condition) || condition
    : '';
  const explicitColorValue =
    attributes.color_value || text(item.selectedColorValue) || undefined;
  const details = [
    ['Storage', attributes.storage || text(item.selectedStorage)],
    ['SIM type', attributes.sim_type],
    ['Colour', attributes.color || text(item.selectedColor)],
    ['Condition', conditionLabel],
    ...Object.entries(attributes)
      .filter(
        ([axis]) =>
          ![
            'storage',
            'sim_type',
            'condition',
            'color',
            'color_value',
            'secondary_color',
            'secondary_color_value',
          ].includes(axis)
      )
      .filter(
        ([axis, value]) =>
          axis !== 'variant' ||
          !conditionLabel ||
          (
            formatCanonicalProductConditionLabel(value) || value
          ).toLowerCase() !== conditionLabel.toLowerCase()
      )
      .map(([axis, value]) => [
        axis === 'ram'
          ? 'RAM'
          : axis
              .replaceAll('_', ' ')
              .replace(/^./, (letter) => letter.toUpperCase()),
        value,
      ]),
    [
      'Second colour preference',
      attributes.secondary_color || text(item.secondaryColor),
    ],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (!details.length) return null;

  return (
    <dl
      aria-label="Selected variant"
      className={`${presentation === 'chips' ? 'mt-1 flex flex-wrap gap-1' : 'mt-1 space-y-0.5'} text-xs ${className}`}
    >
      {details.map(([label, value]) => {
        const isColorChip = presentation === 'chips' && label === 'Colour';
        const colorChipStyle = isColorChip
          ? resolveCartColorChipStyle(value, explicitColorValue)
          : undefined;

        return (
          <div
            className={
              presentation === 'chips'
                ? label === 'Condition'
                  ? 'sr-only'
                  : isColorChip
                    ? 'inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-tight'
                    : 'inline-flex max-w-full items-center rounded bg-store-background-text/5 px-1.5 py-0.5 text-[10px] font-medium leading-tight ring-1 ring-inset ring-store-background-text/8'
                : 'flex flex-wrap gap-x-1'
            }
            style={colorChipStyle}
            key={label}
          >
            <dt className={presentation === 'chips' ? 'sr-only' : undefined}>
              {label}:
            </dt>
            {presentation === 'chips' && label === 'Condition' ? (
              <dd>
                <span className="sr-only">{value}</span>
              </dd>
            ) : (
              <dd className="break-words">
                {value}
                {presentation === 'chips' && label === 'RAM' ? ' RAM' : ''}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
