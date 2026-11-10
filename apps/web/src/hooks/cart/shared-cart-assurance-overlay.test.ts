import { expect, it } from 'vitest';
import { withoutAssuranceOverlay } from './shared-cart-assurance-overlay';
import { initialSharedCartState } from './shared-cart-state';

it('removes only the cancelled coverage choice while preserving other line overlays', () => {
  const state = {
    ...initialSharedCartState,
    assuranceOverlays: { target: true, other: true },
  };
  expect(
    withoutAssuranceOverlay(state, {
      intent: {
        kind: 'set_assurance',
        target: { kind: 'identity', key: 'target' },
        hasAssurance: true,
      },
    } as never)
  ).toEqual({ other: true });
  expect(withoutAssuranceOverlay(state, undefined)).toBe(
    state.assuranceOverlays
  );
});
