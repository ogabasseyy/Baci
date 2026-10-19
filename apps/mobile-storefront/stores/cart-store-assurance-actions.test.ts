import { createAssuranceActions } from './cart-store-assurance-actions';
import type { CartState } from './cart-store-state';

type SetFn = Parameters<typeof createAssuranceActions>[0];

function makeState(overrides: Partial<CartState['items'][number]> = {}) {
  return {
    items: [
      {
        id: 'line-1',
        hasAssurance: false,
        assurancePendingSetting: true,
        ...overrides,
      },
    ],
  } as CartState;
}

function runReconcile(state: CartState, enabled: boolean): CartState {
  let next = state;
  const set = ((updater: (s: CartState) => CartState | Partial<CartState>) => {
    const out = updater(state);
    next = ('items' in out ? out : { ...state, ...out }) as CartState;
  }) as SetFn;
  createAssuranceActions(set).reconcilePendingAssuranceLines(enabled);
  return next;
}

describe('createAssuranceActions.reconcilePendingAssuranceLines', () => {
  it('opts pending lines in when the merchant service is confirmed on', () => {
    const next = runReconcile(makeState(), true);
    expect(next.items[0]?.hasAssurance).toBe(true);
    expect(next.items[0]?.assurancePendingSetting).toBeUndefined();
  });

  it('strips a pending-add true when the merchant service is off', () => {
    const next = runReconcile(makeState({ hasAssurance: true }), false);
    expect(next.items[0]?.hasAssurance).toBe(false);
    expect(next.items[0]?.assurancePendingSetting).toBeUndefined();
  });

  it('leaves non-pending lines untouched', () => {
    const state = makeState({
      assurancePendingSetting: undefined,
      hasAssurance: true,
    });
    const next = runReconcile(state, false);
    expect(next).toBe(state);
  });
});
