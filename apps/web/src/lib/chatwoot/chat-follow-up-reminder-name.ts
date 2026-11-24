const GENERIC_NAME = 'customer';
// The engine names anonymous visitors like "withered-sun-554".
const VISITOR_SLUG = /^[a-z]+(?:-[a-z]+)+-\d{1,4}$/i;

/**
 * The customer name a reminder push may show in its title: a real name only.
 * The generic fallback and anonymous visitor slugs give an empty name, so the
 * push reads "Time to follow up" instead of "Follow up: withered-sun-554".
 */
export function reminderCustomerName(name: string | null | undefined): string {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === GENERIC_NAME ||
    VISITOR_SLUG.test(trimmed)
  ) {
    return '';
  }
  return trimmed.length > 80 ? trimmed.slice(0, 80).trim() : trimmed;
}
