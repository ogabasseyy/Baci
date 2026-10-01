import { z } from 'zod';

/**
 * Client-side date-of-birth validation for the Super Quiz 18+ age gate. Mirrors
 * `apps/web/src/schemas/customer-date-of-birth.ts` so the mobile and web clients
 * feed the authoritative `set_customer_date_of_birth` RPC the same well-formed
 * `YYYY-MM-DD` value.
 *
 * This validates that the value is a real, past calendar date within a
 * plausible lifespan — it does NOT decide quiz eligibility. The 18+ decision is
 * owned server-side by the quiz age gate, which remains the single source of
 * truth; the client only collects a well-formed date of birth.
 */

export const MAX_PLAUSIBLE_AGE_YEARS = 120;

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // A rolled-over date (e.g. 2026-02-30 → Mar 2) fails this identity check.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isPastWithinLifespan(value: string): boolean {
  const dob = new Date(`${value}T00:00:00.000Z`).getTime();
  if (Number.isNaN(dob)) {
    return false;
  }
  const now = new Date();
  // Reject today and any future date. The set_customer_date_of_birth RPC rejects
  // `>= now()::date`, and the native date picker opens on today, so accepting
  // today here would let a value through the client only for the RPC to reject.
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  if (dob >= todayUtc) {
    return false;
  }
  const earliest = Date.UTC(
    now.getUTCFullYear() - MAX_PLAUSIBLE_AGE_YEARS,
    now.getUTCMonth(),
    now.getUTCDate()
  );
  return dob >= earliest;
}

export const DateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth as YYYY-MM-DD')
  .refine(isRealCalendarDate, 'Enter a valid date')
  .refine(isPastWithinLifespan, 'Enter a valid date of birth');

export type DateOfBirth = z.infer<typeof DateOfBirthSchema>;

/**
 * Returns a friendly validation message, or null when the date of birth is a
 * real, past calendar date within a plausible lifespan.
 */
export function getDateOfBirthValidationError(value: string): string | null {
  const result = DateOfBirthSchema.safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? 'Enter a valid date of birth';
}

/**
 * Returns true only for a well-formed DOB whose owner has reached 18 today.
 * This is a privacy-safe client hint for age-sensitive SDK configuration; the
 * quiz API remains authoritative and must re-check the stored DOB.
 */
export function isAdultDateOfBirth(
  value: string | null | undefined,
  now = new Date()
): boolean {
  if (!value || !DateOfBirthSchema.safeParse(value).success) return false;
  const [year, month, day] = value.split('-').map(Number);
  const eighteenthBirthday = Date.UTC(
    now.getUTCFullYear() - 18,
    now.getUTCMonth(),
    now.getUTCDate()
  );
  return Date.UTC(year, month - 1, day) <= eighteenthBirthday;
}
