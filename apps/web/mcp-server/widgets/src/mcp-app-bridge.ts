import { App } from '@modelcontextprotocol/ext-apps';
import type {} from './hooks/use-openai-global';
import { resetWidgetHost, updateWidgetHost } from './widget-host';

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
    await app.close();
    resetWidgetHost();
    // Frozen/cached legacy resources may run in hosts without ui/initialize.
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
      : undefined,
    openExternal: async ({ href }) => {
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
    },
    requestDisplayMode: context?.availableDisplayModes?.includes('fullscreen')
      ? ({ mode }) => app.requestDisplayMode({ mode })
      : undefined,
    notifyIntrinsicHeight: (height) => {
      void app.sendSizeChanged({ height });
    },
    sendFollowUpMessage: ({ prompt }) => {
      void app.sendMessage({
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      });
    },
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
    const toolOutput = {
      status: 'error',
      products: [],
      message:
        'Unable to connect to the shopping interface. Use the conversation to continue.',
    };
    updateWidgetHost({ toolOutput });
  }
}
