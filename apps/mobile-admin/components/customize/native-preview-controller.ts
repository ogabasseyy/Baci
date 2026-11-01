import { parseNativePreviewResponse } from './native-preview-response';

export function createNativePreviewController(nonce: string) {
  let ready = false;
  let latestRevision = -1;
  let pending: number | null = null;
  let rendered: number | null = null;
  return {
    begin(revision: number): boolean {
      if (
        !ready ||
        !Number.isInteger(revision) ||
        revision < 0 ||
        revision > 2_147_483_647 ||
        revision <= latestRevision
      )
        return false;
      latestRevision = revision;
      pending = revision;
      return true;
    },
    receive(raw: string): 'ready' | 'rendered' | 'error' | null {
      const response = parseNativePreviewResponse(raw);
      if (!response || response.sessionNonce !== nonce) return null;
      if (response.type === 'baci.builder-preview.native-ready') {
        if (ready) return null;
        ready = true;
        return 'ready';
      }
      if (!ready || pending === null || response.revision !== pending)
        return null;
      pending = null;
      if (response.type === 'baci.builder-preview.native-rendered') {
        rendered = response.revision;
        return 'rendered';
      }
      return 'error';
    },
    timeout(revision: number): boolean {
      if (pending !== revision) return false;
      pending = null;
      return true;
    },
    lastRendered(): number | null {
      return rendered;
    },
  };
}
