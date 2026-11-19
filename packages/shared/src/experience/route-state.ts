import type { RouteState } from './types';
export function advanceRoute(
  state: RouteState,
  next: Omit<RouteState, 'epoch'>
): RouteState {
  if (
    !Number.isSafeInteger(state.epoch) ||
    state.epoch < 1 ||
    state.epoch >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('Invalid route epoch');
  return { ...next, params: { ...next.params }, epoch: state.epoch + 1 };
}
