type SlotState = {
  visible: number | null;
  pending: number | null;
  failed: number | null;
};
type SlotAction =
  | { type: 'start'; slot: number }
  | { type: 'rendered'; slot: number }
  | { type: 'failed'; slot: number }
  | { type: 'reset' };

export const initialPreviewSlots: SlotState = {
  visible: null,
  pending: null,
  failed: null,
};

export function reducePreviewSlots(
  state: SlotState,
  action: SlotAction
): SlotState {
  switch (action.type) {
    case 'start':
      return { ...state, pending: action.slot, failed: null };
    case 'rendered':
      return state.pending === action.slot
        ? { visible: action.slot, pending: null, failed: null }
        : state;
    case 'failed':
      return state.pending === action.slot
        ? { ...state, pending: null, failed: action.slot }
        : state;
    case 'reset':
      return initialPreviewSlots;
  }
}
