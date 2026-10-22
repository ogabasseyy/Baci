import { App } from '@modelcontextprotocol/ext-apps/app-with-deps';
import { BUILDER_EDITOR_URL } from '../../../src/schemas/builder-mcp-primitives';
import {
  builderPreviewResultSchema,
  type PreviewResult,
} from '../../../src/schemas/builder-mcp-results';
import { hasSafeBuilderPreviewAssets } from '../../../src/schemas/builder-preview-assets';
export interface PreviewState {
  preview: PreviewResult | null;
  error: string | null;
  hostError: string | null;
  theme: 'light' | 'dark';
  mode: 'inline' | 'fullscreen';
  ready: boolean;
}
interface HostActions {
  size: (height: number) => Promise<unknown>;
  expand: () => Promise<unknown>;
  open: () => Promise<unknown>;
}
export function createPreviewHost() {
  let state: PreviewState = {
    preview: null,
    error: null,
    hostError: null,
    theme: 'light',
    mode: 'inline',
    ready: false,
  };
  let actions: HostActions | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<PreviewState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    attach: (value: HostActions) => {
      actions = value;
      update({ ready: true });
    },
    waiting: () => update({ preview: null, error: null, hostError: null }),
    result: (value: { isError?: boolean; structuredContent?: unknown }) => {
      const parsed = builderPreviewResultSchema.safeParse(
        value.structuredContent
      );
      if (
        value.isError ||
        !parsed.success ||
        !hasSafeBuilderPreviewAssets(parsed.data.projection)
      ) {
        const code =
          value.structuredContent &&
          typeof value.structuredContent === 'object' &&
          'code' in value.structuredContent
            ? value.structuredContent.code
            : null;
        update({
          preview: null,
          hostError: null,
          error:
            code === 'CONNECTION_REVOKED' || code === 'INSUFFICIENT_SCOPE'
              ? 'Reconnect or authorize your Baci account in the conversation to continue.'
              : 'Homepage preview unavailable. Request a fresh preview or open the Baci editor.',
        });
      } else update({ preview: parsed.data, error: null, hostError: null });
    },
    size: (height: number) => {
      void actions
        ?.size(Math.min(10000, Math.max(1, Math.ceil(height))))
        .catch(() => {
          /* Host may manage sizing itself. */
        });
    },
    expand: async () => {
      try {
        if (!actions) throw Error();
        await actions.expand();
        update({ hostError: null });
      } catch {
        update({
          hostError:
            'Could not expand the preview. Continue using the inline view.',
        });
      }
    },
    open: async () => {
      try {
        if (!actions) throw Error();
        await actions.open();
        update({ hostError: null });
      } catch {
        update({
          hostError:
            'Could not open Baci. Visit https://usebaci.com/builder to continue.',
        });
      }
    },
    clear: () => {
      actions = undefined;
      update({ preview: null, error: null, hostError: null, ready: false });
    },
  };
}
export type PreviewHost = ReturnType<typeof createPreviewHost>;
export async function connectPreviewApp(host: PreviewHost) {
  const app = new App(
    { name: 'Baci homepage preview', version: '1.0.0' },
    { availableDisplayModes: ['inline', 'fullscreen'] },
    { autoResize: false }
  );
  let closed = false;
  const context = (value: ReturnType<typeof app.getHostContext>) => {
    if (closed || !value) return;
    host.update({
      ...(value.theme
        ? { theme: value.theme === 'dark' ? 'dark' : 'light' }
        : {}),
      ...(value.displayMode
        ? { mode: value.displayMode === 'fullscreen' ? 'fullscreen' : 'inline' }
        : {}),
    });
  };
  app.ontoolinput = () => {
    if (!closed) host.waiting();
  };
  app.ontoolresult = (value) => {
    if (!closed) host.result(value);
  };
  app.ontoolcancelled = () => {
    if (!closed)
      host.update({
        preview: null,
        error: 'Preview cancelled. Request a new preview in the conversation.',
      });
  };
  app.onhostcontextchanged = context;
  app.onteardown = () => {
    closed = true;
    host.clear();
    return Promise.resolve({});
  };
  try {
    await app.connect(undefined, { timeout: 10000 });
    if (!closed) {
      context(app.getHostContext());
      host.attach({
        size: (height) => app.sendSizeChanged({ height }),
        expand: async () => {
          if (
            !app.getHostContext()?.availableDisplayModes?.includes('fullscreen')
          )
            throw Error();
          const result = await app.requestDisplayMode({ mode: 'fullscreen' });
          if (result.mode !== 'fullscreen') throw Error();
          host.update({ mode: 'fullscreen' });
        },
        open: async () => {
          if (!app.getHostCapabilities()?.openLinks) throw Error();
          const result = await app.openLink({ url: BUILDER_EDITOR_URL });
          if (result.isError) throw Error();
        },
      });
    }
  } catch {
    closed = true;
    host.update({
      preview: null,
      error:
        'Could not connect the preview. Request a fresh preview in the conversation.',
    });
    await app.close().catch(() => {
      /* Connection failure is already shown. */
    });
  }
  return async () => {
    closed = true;
    host.clear();
    await app.close();
  };
}
