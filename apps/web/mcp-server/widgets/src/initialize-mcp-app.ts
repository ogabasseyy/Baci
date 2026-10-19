import { connectMcpApp } from './mcp-app-bridge';
import { widgetHost } from './widget-host';

/** Connect the MCP Apps transport and expose a safe fallback on failure. */
export async function initializeMcpApp() {
  try {
    await connectMcpApp();
  } catch {
    if (widgetHost.get()?.toolOutput != null) return;
    const toolOutput = {
      status: 'error',
      products: [],
      message:
        'Unable to connect to the shopping interface. Use the conversation to continue.',
    };
    widgetHost.update({ toolOutput });
  }
}
