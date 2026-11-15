import type { Product } from '@/lib/products';
import {
  formatVariantAxisLabel,
  formatVariantOptionLabel,
  getVariantAxisOptions,
} from './critical-variant-selector-options';

export function ProductFixedOptions({
  variants,
  selectableAxes,
}: {
  variants: Product['variants'];
  selectableAxes: string[];
}) {
  const facts = [
    'ram',
    'storage',
    'color',
    'connectivity',
    'platform',
    'size',
  ].flatMap((axis) => {
    if (selectableAxes.includes(axis)) return [];
    const values = getVariantAxisOptions(variants, axis, {});
    return values.length === 1 ? [{ axis, value: values[0] }] : [];
  });
  if (!facts.length) return null;
  return (
    <dl data-ogabassey-pdp-fixed-options aria-label="Product configuration">
      {facts.map(({ axis, value }) => (
        <div key={axis}>
          <dt>{formatVariantAxisLabel(axis)}</dt>
          <dd>{formatVariantOptionLabel(axis, value)}</dd>
        </div>
      ))}
    </dl>
  );
}
