import { App } from '@modelcontextprotocol/ext-apps';
import type {} from './hooks/use-openai-global';

/** Keep the UI's existing host adapter while supporting standard MCP Apps hosts. */
export async function connectMcpApp() {
  // Existing ChatGPT sessions already provide their bridge and persisted state.
  if (window.openai?.callTool) return;
  const app = new App({ name: 'Ogabassey catalog', version: '1.0.0' }, {});
  const update = (globals: Partial<NonNullable<Window['openai']>>) => {
    window.openai = { ...window.openai, ...globals };
    window.dispatchEvent(
      new CustomEvent('openai:set_globals', { detail: { globals } }),
    );
  };
  app.ontoolresult = (result) =>
    update({
      toolOutput: result.structuredContent,
      toolResponseMetadata: result,
    });
  app.ontoolinput = (input) => update({ toolInput: input.arguments });
  app.onhostcontextchanged = (context) => update(context);
  app.ontoolcancelled = () =>
    update({
      toolOutput: {
        status: 'error',
        message: 'Product display was cancelled.',
        products: [],
      },
    });
  await app.connect();
  update({
    ...app.getHostContext(),
    callTool: (name, args) => app.callServerTool({ name, arguments: args }),
    openExternal: ({ href }) => {
      void app.openLink({ url: href });
    },
    requestDisplayMode: ({ mode }) => app.requestDisplayMode({ mode }),
    notifyIntrinsicHeight: (height) => {
      void app.sendSizeChanged({ height });
    },
    setWidgetState: (widgetState) => update({ widgetState }),
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
    window.openai = { ...window.openai, toolOutput };
    window.dispatchEvent(
      new CustomEvent('openai:set_globals', {
        detail: { globals: { toolOutput } },
      }),
    );
  }
}
