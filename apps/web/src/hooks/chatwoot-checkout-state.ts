import {
  getSubdivisions,
  resolveSubdivisionCode,
} from '@/lib/shipping/merchant-rates/subdivisions';

/** Canonical Nigerian state name, or null when the input is not one. */
export function resolveChatwootCheckoutState(state: string): string | null {
  const code = resolveSubdivisionCode('NG', state);
  return (
    getSubdivisions('NG').find((entry) => entry.code === code)?.name ?? null
  );
}
