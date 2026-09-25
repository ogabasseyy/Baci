const STORAGE_KEY = 'baci:jumia-discovery-resume';

export type JumiaDiscoveryResume = {
  clientId: string;
  discoveryId: string;
};

function read(): JumiaDiscoveryResume | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { clientId?: unknown }).clientId !== 'string' ||
      typeof (parsed as { discoveryId?: unknown }).discoveryId !== 'string'
    ) {
      return null;
    }
    const clientId = (parsed as { clientId: string }).clientId.trim();
    const discoveryId = (parsed as { discoveryId: string }).discoveryId.trim();
    return clientId && discoveryId ? { clientId, discoveryId } : null;
  } catch {
    return null;
  }
}

function write(clientId: string, discoveryId: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (clientId.trim() && discoveryId.trim()) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          clientId: clientId.trim(),
          discoveryId: discoveryId.trim(),
        })
      );
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browsers. The server
    // still owns the discovery state, so the in-memory flow remains usable.
  }
}

function clear(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures; clearing the in-memory state is still safe.
  }
}

export const jumiaDiscoveryResumeStorage = { clear, read, write };
