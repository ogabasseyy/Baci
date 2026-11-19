import { escapeHtmlAttribute } from '@/lib/sanitize';
import type { JumiaCreateProduct } from '@/schemas/jumia/create-product';

export interface JumiaContentError {
  field: string;
  message: string;
}

export type JumiaPreparedContent = Pick<
  JumiaCreateProduct,
  'name' | 'description'
> & {
  shortDescriptionHtml: string;
  productWeightKg: number;
};

export type JumiaContentResult =
  | { success: false; errors: JumiaContentError[] }
  | {
      success: true;
      content: JumiaPreparedContent;
      classificationBoundary:
        | 'provider-classification-required'
        | 'explicit-provider-classification';
    };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Reflect.ownKeys(value).every(
    (key) =>
      typeof key === 'string' &&
      'value' in (Object.getOwnPropertyDescriptor(value, key) ?? {})
  );

const own = (value: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined;

/**
 * Local content policy only, NOT canonical-source proof or provider readiness.
 * Callers supply plain-text facts. The create-shaped JSON name retains raw
 * title bytes; generated description/list HTML escapes literal markup.
 * Unknown classification only meets the general four-bullet floor, not 3C.
 * Future authorized loaders must establish classification and weight units.
 * This never fills category-required metadata: the canonical serializer must
 * inject authoritative special fields and rerun whole-set attribute validation.
 */
export function prepareJumiaListingContent(input: unknown): JumiaContentResult {
  if (!record(input))
    return {
      success: false,
      errors: [{ field: 'content', message: 'Supply explicit listing facts.' }],
    };
  const errors: JumiaContentError[] = [];
  const error = (field: string, message: string) =>
    errors.push({ field, message });
  const title = own(input, 'title');
  const description = own(input, 'description');
  const bullets = own(input, 'bullets');
  const providerClassification = own(input, 'providerClassification');
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length < 15 ||
    title.length > 60
  )
    error('title', 'Supply a nonempty title of 15–60 characters.');
  if (typeof description !== 'string' || !description.trim())
    error('description', 'Supply a nonempty plain-text description.');

  const minimum = providerClassification === '3c' ? 7 : 4;
  const plainBullets: string[] = [];
  if (Array.isArray(bullets)) {
    for (let index = 0; index < bullets.length; index++) {
      const item = Object.getOwnPropertyDescriptor(bullets, index);
      if (
        item &&
        'value' in item &&
        typeof item.value === 'string' &&
        item.value.trim()
      )
        plainBullets.push(item.value);
    }
  }
  if (plainBullets.length < minimum)
    error('bullets', `Supply at least ${minimum} nonempty plain-text bullets.`);
  if (Array.isArray(bullets)) {
    for (let index = 0; index < bullets.length; index++) {
      if (
        !('value' in (Object.getOwnPropertyDescriptor(bullets, index) ?? {})) ||
        typeof bullets[index] !== 'string' ||
        !bullets[index].trim()
      )
        error(`bullets.${index}`, 'Supply a nonempty plain-text bullet.');
    }
  }
  if (
    providerClassification !== undefined &&
    !['unknown', '3c', 'non-3c'].includes(providerClassification as string)
  )
    error(
      'providerClassification',
      'Supply an explicit provider classification or unknown.'
    );

  const suppliedWeight = own(input, 'weight');
  const weight = record(suppliedWeight) ? suppliedWeight : {};
  const value = own(weight, 'value');
  const unit = own(weight, 'unit');
  let kilograms: number | undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    error('weight.value', 'Supply a known positive finite weight.');
  if (unit !== 'g' && unit !== 'kg')
    error('weight.unit', 'Supply a verified weight unit: g or kg.');
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    (unit === 'g' || unit === 'kg')
  ) {
    kilograms = unit === 'g' ? value / 1000 : value;
    if (!Number.isFinite(kilograms) || kilograms <= 0)
      error(
        'weight.value',
        'Weight must remain positive and finite in kilograms.'
      );
  }
  if (errors.length) return { success: false, errors };

  // Narrow only after all fields have been checked; no partial prepared result.
  return {
    success: true,
    content: {
      name: { value: title as string },
      description: { value: escapeHtmlAttribute(description as string) },
      shortDescriptionHtml: `<ul>${plainBullets.map((bullet) => `<li>${escapeHtmlAttribute(bullet)}</li>`).join('')}</ul>`,
      productWeightKg: kilograms as number,
    },
    classificationBoundary:
      providerClassification === '3c' || providerClassification === 'non-3c'
        ? 'explicit-provider-classification'
        : 'provider-classification-required',
  };
}
