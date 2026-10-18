import { App } from '@modelcontextprotocol/ext-apps/app-with-deps';
import type {} from './hooks/use-openai-global';
import {
  getWidgetHost,
  resetWidgetHost,
  updateWidgetHost,
} from './widget-host';

/** Standard MCP Apps transport, adapted to the widget's existing host interface. */
export async function connectMcpApp() {
  const extensions = window.openai;
  const app = new App(
    { name: 'Ogabassey catalog', version: '1.0.0' },
    {},
    { autoResize: false },
  );
  const update = updateWidgetHost;
  app.ontoolresult = (result) =>
    update({
      toolOutput: result.structuredContent,
      toolResponseMetadata: result._meta,
    });
  app.ontoolinput = (input) => update({ toolInput: input.arguments });
  app.onhostcontextchanged = (context) =>
    update({
      ...context,
      ...(context.safeAreaInsets
        ? { safeArea: { insets: context.safeAreaInsets } }
        : {}),
    });
  app.ontoolcancelled = () =>
    update({
      toolOutput: {
        status: 'error',
        message: 'Product display was cancelled.',
        products: [],
      },
    });
  try {
    await app.connect(undefined, { timeout: 10000 });
  } catch (error) {
    const deliveredOutput = getWidgetHost()?.toolOutput;
    await app.close().catch(() => {});
    resetWidgetHost();
    // Read-only legacy hosts can display results without cart tool support.
    if (deliveredOutput != null) {
      if (deliveredOutput !== extensions?.toolOutput)
        update({ toolOutput: deliveredOutput });
      return;
    }
    if (extensions?.callTool) return;
    throw error;
  }
  const context = app.getHostContext();
  const capabilities = app.getHostCapabilities();
  update({
    ...context,
    ...(context?.safeAreaInsets
      ? { safeArea: { insets: context.safeAreaInsets } }
      : {}),
    callTool: capabilities?.serverTools
      ? (name, args) => app.callServerTool({ name, arguments: args })
      : extensions?.callTool?.bind(extensions),
    openExternal: capabilities?.openLinks
      ? async ({ href }) => {
          update({ hostError: null });
          try {
            const result = await app.openLink({ url: href });
            if (result.isError) throw new Error('Link denied');
          } catch {
            update({
              hostError:
                'Could not open Ogabassey. Please try again or continue in the conversation.',
            });
          }
        }
      : extensions?.openExternal?.bind(extensions),
    requestDisplayMode: context?.availableDisplayModes?.includes('fullscreen')
      ? async ({ mode }) => {
          update({ hostError: null });
          try {
            const result = await app.requestDisplayMode({ mode });
            if (result.mode !== mode) throw new Error('Display mode declined');
            return result;
          } catch {
            update({
              hostError:
                'Could not expand the catalog. Continue using the inline view.',
            });
          }
        }
      : undefined,
    notifyIntrinsicHeight: async (height) => {
      try {
        await app.sendSizeChanged({ height });
      } catch {
        console.warn('Ogabassey widget size notification failed.');
      }
    },
    sendFollowUpMessage: capabilities?.message?.text
      ? async ({ prompt }) => {
          update({ hostError: null });
          try {
            const result = await app.sendMessage({
              role: 'user',
              content: [{ type: 'text', text: prompt }],
            });
            if (result.isError) throw new Error('Message declined');
          } catch {
            update({
              hostError:
                'Could not send your message. Please type it in the conversation.',
            });
          }
        }
      : extensions?.sendFollowUpMessage?.bind(extensions),
    setWidgetState: (widgetState) => {
      extensions?.setWidgetState?.(widgetState);
      update({ widgetState });
    },
  });
}

export async function initializeMcpApp() {
  try {
    await connectMcpApp();
  } catch {
    if (getWidgetHost()?.toolOutput != null) return;
    const toolOutput = {
      status: 'error',
      products: [],
      message:
        'Unable to connect to the shopping interface. Use the conversation to continue.',
    };
    updateWidgetHost({ toolOutput });
  }
}
