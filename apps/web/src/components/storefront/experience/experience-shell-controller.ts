import type { ExperienceBoundaryData } from '@/lib/experience/storefront-runtime';
export interface ExperienceShellState {
  lease: string;
  data: ExperienceBoundaryData;
  active: boolean;
  fallbackFresh: boolean;
  ready: boolean;
  transitioning: boolean;
}
export function createExperienceShellController() {
  let state: ExperienceShellState | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => null,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    activate(lease: string, data: ExperienceBoundaryData) {
      const previous = state;
      const same =
        previous?.active === true &&
        previous.data.manifest.buildDigest === data.manifest.buildDigest &&
        previous.data.manifest.policyRevision === data.manifest.policyRevision;
      const route = {
        ...data.bootstrap.route,
        epoch: same ? previous.data.bootstrap.route.epoch + 1 : 1,
      };
      const launch = same ? previous.data.launch : data.launch;
      state = {
        lease,
        transitioning: false,
        ready: same ? (previous?.ready ?? false) : false,
        active:
          previous?.active !== false ||
          data.launch.instanceId !== previous.data.launch.instanceId,
        fallbackFresh: true,
        data: { ...data, launch, bootstrap: { ...data.bootstrap, route } },
      };
      emit();
    },
    release(_lease: string) {
      // Route boundaries can disappear while Next streams the next one. The
      // persistent shell owns document retirement on native routes/unmount.
    },
    beginTransition() {
      if (state) {
        state = { ...state, transitioning: true };
        emit();
      }
    },
    markReady(instanceId: string) {
      if (state?.active && state.data.launch.instanceId === instanceId) {
        state = { ...state, ready: true };
        emit();
      }
    },
    withdraw() {
      if (state) {
        state = { ...state, active: false, fallbackFresh: false };
        emit();
      }
    },
    failFrame() {
      if (state) {
        state = { ...state, active: false, fallbackFresh: true };
        emit();
      }
    },
    exit() {
      state = null;
      emit();
    },
  };
}
export type ExperienceShellController = ReturnType<
  typeof createExperienceShellController
>;
