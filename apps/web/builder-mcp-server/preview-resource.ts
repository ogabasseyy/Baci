import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/server';
import { BUILDER_PREVIEW_ASSET_ORIGINS } from '../src/schemas/builder-preview-assets';
export const BUILDER_PREVIEW_URI = 'ui://baci-builder/home-preview-v1.html';
export const builderPreviewToolMeta = {
  ui: { resourceUri: BUILDER_PREVIEW_URI },
};
/** Only static code is cached. Authorized snapshots arrive in tool results, never this HTML. */
export function registerBuilderPreviewResource(server: McpServer) {
  server.registerResource(
    'baci-homepage-preview',
    BUILDER_PREVIEW_URI,
    {
      mimeType: 'text/html;profile=mcp-app',
      description: 'Private inert Baci homepage preview',
    },
    async () => ({
      contents: [
        {
          uri: BUILDER_PREVIEW_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: await readFile(
            new URL('./preview.html', import.meta.url),
            'utf8'
          ),
          _meta: {
            ui: {
              prefersBorder: true,
              domain: 'https://mcp.usebaci.com',
              csp: {
                connectDomains: [],
                frameDomains: [],
                resourceDomains: [...BUILDER_PREVIEW_ASSET_ORIGINS],
              },
            },
            'openai/widgetDescription':
              'Exact private homepage revision. Store links and shopping controls are disabled.',
          },
        },
      ],
    })
  );
}
