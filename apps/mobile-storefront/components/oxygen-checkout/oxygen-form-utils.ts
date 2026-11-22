import type { OxygenFormDraft } from '@baci/shared/oxygen';
export type OxygenFields = OxygenFormDraft['fields'];
export interface OxygenBank {
  code: string;
  name: string;
}
export function filterOxygenBanks(banks: readonly OxygenBank[], query: string) {
  const normalizedQuery = query.toLocaleLowerCase().replace(/\s+/g, '');
  return banks
    .filter((bank) =>
      bank.name
        .toLocaleLowerCase()
        .replace(/\s+/g, '')
        .includes(normalizedQuery)
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function reusableHomeAddress(
  address?: { kind: 'pickup' | 'delivery'; fields: OxygenFields } | null
): OxygenFields | null {
  if (address?.kind !== 'delivery') return null;
  const fields = address.fields;
  return ['home_street', 'home_state'].every((key) =>
    fields[key as keyof OxygenFields]?.trim()
  )
    ? fields
    : null;
}
export const OXYGEN_PROOF_MAX_BYTES = 1_572_864;
export function validateOxygenProof(file: {
  size?: number;
  mimeType?: string | null;
}): string | null {
  if (
    !['application/pdf', 'image/jpeg', 'image/png'].includes(
      file.mimeType ?? ''
    )
  )
    return 'Choose a PDF, JPEG or PNG file.';
  if (!Number.isSafeInteger(file.size) || (file.size ?? 0) <= 0)
    return 'Could not read this file. Choose another file.';
  return (file.size ?? 0) > OXYGEN_PROOF_MAX_BYTES
    ? 'Choose a file no larger than 1.5 MB.'
    : null;
}
export function otpRemainingSeconds(
  window: { sentAt?: string | null; expiresAt?: string | null },
  now: number
): number {
  const expiry = window.expiresAt
    ? Date.parse(window.expiresAt)
    : window.sentAt
      ? Date.parse(window.sentAt) + 300_000
      : Number.NaN;
  return Number.isFinite(expiry)
    ? Math.max(0, Math.ceil((expiry - now) / 1000))
    : 0;
}
