import type { fetchRuntimeImeiTierKeys } from './runtime-availability';
import type { ImeiDeviceCategory } from './service-tier-types';
import type { ImeiServiceTierKey } from './service-tiers';

interface Snapshot {
  device: ImeiDeviceCategory | null;
  availableTierKeys: ImeiServiceTierKey[] | null;
  failed: boolean;
  loading: boolean;
}

const REQUEST_TIMEOUT_MS = 8000;

/** Framework-independent lifecycle shared by web and native external-store hooks. */
export function createRuntimeImeiAvailability({
  fetchTierKeys,
  apiBaseUrl,
}: {
  fetchTierKeys: typeof fetchRuntimeImeiTierKeys;
  apiBaseUrl?: string;
}) {
  let snapshot: Snapshot = {
    device: null,
    availableTierKeys: null,
    failed: false,
    loading: true,
  };
  let cancel: () => void = () => undefined;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  function request(device: ImeiDeviceCategory) {
    cancel();
    let active = true;
    const controller = new AbortController();
    publish({ device, availableTierKeys: null, failed: false, loading: true });
    const fail = () => {
      if (active)
        publish({
          device,
          availableTierKeys: null,
          failed: true,
          loading: false,
        });
    };
    const timer = setTimeout(() => {
      fail();
      active = false;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    cancel = () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
    // Normalize synchronous transport throws into the same failure handling.
    async function fetchKeys() {
      return await fetchTierKeys({
        device,
        apiBaseUrl,
        signal: controller.signal,
      });
    }
    fetchKeys()
      .then((keys) => {
        if (active)
          publish({
            device,
            availableTierKeys: keys,
            failed: false,
            loading: false,
          });
      })
      .catch(fail)
      .finally(() => clearTimeout(timer));
  }
  const retry = () => {
    if (snapshot.device) request(snapshot.device);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: (device: ImeiDeviceCategory) => {
      request(device);
      // Retry replaces the active request, so unmount must cancel the latest one.
      return () => cancel();
    },
    getView: (device: ImeiDeviceCategory, current: Snapshot) => ({
      availableTierKeys:
        current.device === device ? current.availableTierKeys : null,
      failed: current.device === device && current.failed,
      loading: current.device !== device || current.loading,
      retry,
    }),
  };
}
