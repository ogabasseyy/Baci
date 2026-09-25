import { z } from 'zod';

const isoDateRegex =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?)?$/;

function isValidCalendarDate(value: string): boolean {
  const [datePart] = value.split('T');
  const [yearText, monthText, dayText] = datePart.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

const saleDateSchema = z
  .string()
  .regex(isoDateRegex, 'Must be YYYY-MM-DD or ISO 8601 datetime')
  .refine(isValidCalendarDate, {
    error: 'Calendar-invalid date (e.g. Feb 31)',
  })
  .nullable()
  .optional();

export const jumiaProductUpdateSchema = z.object({
  productId: z.uuid(),
  integrationId: z.uuid(),
  overrides: z
    .object({
      jumia_price: z.number().positive().optional(),
      jumia_prices: z
        .record(z.string().trim().min(1), z.number().positive())
        .optional(),
      jumia_sale_price: z.number().positive().nullable().optional(),
      jumia_sale_start: saleDateSchema,
      jumia_sale_end: saleDateSchema,
      is_active: z.boolean().optional(),
    })
    .refine(
      (overrides) =>
        Object.hasOwn(overrides, 'jumia_sale_start') ===
        Object.hasOwn(overrides, 'jumia_sale_end'),
      {
        error:
          'Both jumia_sale_start and jumia_sale_end must be provided together',
      }
    )
    .refine(
      (overrides) =>
        !overrides.jumia_sale_start ||
        !overrides.jumia_sale_end ||
        new Date(overrides.jumia_sale_start) <
          new Date(overrides.jumia_sale_end),
      {
        error: 'jumia_sale_start must be before jumia_sale_end',
      }
    )
    .refine(
      (overrides) =>
        !(
          Object.hasOwn(overrides, 'jumia_price') &&
          Object.hasOwn(overrides, 'jumia_prices')
        ),
      {
        error: 'Provide either jumia_price or jumia_prices, not both',
      }
    ),
});
