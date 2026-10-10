export interface HandoffLine {
  product_id: string;
  quantity: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses `guest_cart` URL values without zod: the served widget must stay
 * dependency-free. Mirrors the server handoff contract (array of unique
 * uuid lines, integer quantities 1-10, at most 20 lines).
 */
export function parseHandoffLines(raw: string | null): HandoffLine[] | null {
  if (!raw || raw.length > 4000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20)
    return null;
  const seen = new Set<string>();
  const lines: HandoffLine[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) return null;
    const { product_id, quantity } = item;
    if (typeof product_id !== 'string' || !UUID_PATTERN.test(product_id))
      return null;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10
    )
      return null;
    if (seen.has(product_id.toLowerCase())) return null;
    seen.add(product_id.toLowerCase());
    lines.push({ product_id, quantity });
  }
  return lines;
}
