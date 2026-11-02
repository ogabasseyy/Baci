import { NativeModules } from 'react-native';

type SavingsActivityModule = { clear?: () => void };

// Until auth explicitly initializes the owner, no activity owner is trusted.
let ownerId: string | null = null;
let initialized = false;
let generation = 0;

/** Synchronously fences queued savings activity work at every auth identity change. */
export function setSavingsActivityOwner(nextOwnerId: string | null): void {
  if (initialized && ownerId === nextOwnerId) return;
  initialized = true;
  ownerId = nextOwnerId;
  generation += 1;
  try {
    (
      NativeModules.SavingsLiveActivity as SavingsActivityModule | undefined
    )?.clear?.();
  } catch {
    // The native feature is optional; auth state must not depend on it.
  }
}

export function captureSavingsActivityGeneration(
  owner: string | null | undefined
) {
  return initialized && owner && ownerId !== null && owner === ownerId
    ? generation
    : null;
}

export function isSavingsActivityOwnerCurrent(
  owner: string | null | undefined
) {
  return initialized && Boolean(owner) && ownerId !== null && owner === ownerId;
}

export function isSavingsActivityGenerationCurrent(
  owner: string | null | undefined,
  capturedGeneration: number | null
): boolean {
  return (
    capturedGeneration !== null &&
    initialized &&
    ownerId !== null &&
    owner === ownerId &&
    capturedGeneration === generation
  );
}
