/**
 * A Kuda item code as every price check compares it: case, spaces and
 * punctuation free ("KUD-CAB-DST-1" and "kud cab dst 1" are the same code).
 */
export function normalizeKudaItemCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
