import {
  type BuilderNativePreviewRender,
  builderNativePreviewInitSchema,
  builderNativePreviewRenderSchema,
  MAX_AI_EDIT_BODY_BYTES,
} from '@baci/shared/contracts';

type AcceptedNativeMessage =
  | { kind: 'ready'; sessionNonce: string; rotated: boolean }
  | { kind: 'render'; message: BuilderNativePreviewRender };

export function createNativePreviewSession() {
  let activeNonce: string | null = null;
  let revision = -1;
  return {
    accept(payload: unknown): AcceptedNativeMessage | null {
      if (
        typeof payload !== 'string' ||
        payload.length > MAX_AI_EDIT_BODY_BYTES
      )
        return null;
      if (new TextEncoder().encode(payload).byteLength > MAX_AI_EDIT_BODY_BYTES)
        return null;
      let decoded: unknown;
      try {
        decoded = JSON.parse(payload) as unknown;
      } catch {
        return null;
      }
      const init = builderNativePreviewInitSchema.safeParse(decoded);
      if (init.success) {
        const rotated =
          activeNonce !== null && activeNonce !== init.data.sessionNonce;
        if (rotated) {
          if (init.data.previousSessionNonce !== activeNonce) return null;
          revision = -1;
        }
        activeNonce = init.data.sessionNonce;
        return { kind: 'ready', sessionNonce: activeNonce, rotated };
      }
      const parsed = builderNativePreviewRenderSchema.safeParse(decoded);
      if (
        !parsed.success ||
        activeNonce === null ||
        parsed.data.sessionNonce !== activeNonce ||
        parsed.data.revision <= revision
      )
        return null;
      revision = parsed.data.revision;
      return { kind: 'render', message: parsed.data };
    },
  };
}
