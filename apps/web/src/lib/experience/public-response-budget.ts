import { EXPERIENCE_LIMITS } from '@baci/shared/experience';
export function assertPublicResponseBudget(value: unknown): void {
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    EXPERIENCE_LIMITS.jsonResponseBytes
  )
    throw Error('PUBLIC_RESPONSE_BUDGET');
}
