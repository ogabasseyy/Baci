import { guestCartHandoffSchema } from '@/schemas/guest-cart-handoff';

export function parseGuestCartHandoff(raw: string | null) {
  if (!raw || raw.length > 4000) return null;
  try {
    const result = guestCartHandoffSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
