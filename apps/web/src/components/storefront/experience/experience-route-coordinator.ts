import type { RouteState } from '@baci/shared/experience';
/** Routing changes epoch, never document/MessagePort identity. */
export function createRouteCoordinator(initial: RouteState) {
  let state = { ...initial };
  let generation = 0;
  let transition = false;
  let destroyed = false;
  return {
    current: () => ({ ...state }),
    isTransitioning: () => transition,
    async transitionRoute(
      path: string,
      load: () => Promise<string>,
      routeId = path,
      params: Record<string, string> = {}
    ) {
      if (destroyed) throw Error('LAUNCH_EXPIRED');
      if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[\\%]/.test(path) ||
        [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      )
        throw Error('INVALID_REQUEST');
      const own = ++generation;
      const epoch = state.epoch + 1;
      state = { ...state, epoch };
      transition = true;
      try {
        const revision = await load();
        if (own !== generation || destroyed) return state;
        state = {
          epoch,
          routeId,
          canonicalPath: path,
          params: { ...params },
          publicDataRevision: revision,
        };
        return state;
      } finally {
        if (own === generation) transition = false;
      }
    },
    destroy() {
      destroyed = true;
      generation++;
      transition = true;
    },
  };
}
