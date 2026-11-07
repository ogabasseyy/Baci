'use client';

// Thin props-driven renderer for the interaction shell. Copy, actions, and
// states come from the core; this module only lays them out with the shared
// checkout tokens. Hidden while idle; busy states show a spinner and offer
// no actions.
import { checkoutStyles } from '@/components/storefront/shared/checkout-theme';
import {
  getOxygenInteractionActions,
  getOxygenInteractionCopy,
  OXYGEN_INTERACTION_ACTION_LABELS,
  type OxygenFailedRecovery,
  type OxygenInteractionAction,
  type OxygenInteractionReason,
  type OxygenInteractionState,
} from '@/lib/payments/oxygen/interaction';

export interface OxygenInteractionPanelProps {
  state: OxygenInteractionState;
  reason?: OxygenInteractionReason;
  recoveries?: OxygenFailedRecovery[];
  onAction: (action: OxygenInteractionAction) => void;
}

const BUSY_STATES: ReadonlySet<OxygenInteractionState> = new Set([
  'checking',
  'resuming',
  'initiating',
]);

const ACTION_BUTTON_CLASS = 'px-4 py-2 rounded-lg text-sm font-medium';
const DISMISS_BUTTON_CLASS =
  'px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors';

export function OxygenInteractionPanel({
  state,
  reason,
  recoveries = [],
  onAction,
}: OxygenInteractionPanelProps) {
  if (state === 'idle') {
    return null;
  }
  const copy = getOxygenInteractionCopy(state, reason);
  const actions = getOxygenInteractionActions({ state, reason, recoveries });
  const busy = BUSY_STATES.has(state);
  return (
    <div
      role="status"
      className={`flex flex-col gap-3 p-4 rounded-xl border-2 ${checkoutStyles.activeCard}`}
    >
      <p className="text-sm text-gray-900">{copy}</p>
      {busy ? (
        <span
          data-testid="oxygen-interaction-spinner"
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-store-primary/20 border-t-store-primary"
        />
      ) : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action)}
              className={
                action === 'dismiss'
                  ? DISMISS_BUTTON_CLASS
                  : `${checkoutStyles.primaryButton} ${ACTION_BUTTON_CLASS}`
              }
            >
              {OXYGEN_INTERACTION_ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
