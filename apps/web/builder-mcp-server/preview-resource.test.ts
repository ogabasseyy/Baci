// @vitest-environment node
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { expect, it, vi } from 'vitest';
import { BUILDER_PREVIEW_URI } from './preview-resource';
import { createBuilderMcpServer } from './server';

it('advertises a tenant-neutral standard resource only on preview; never embeds merchant data', async () => {
  const server = createBuilderMcpServer({ executeBuilderTool: vi.fn() });
  const client = new Client({ name: 'fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
    for (const tool of tools)
      if (tool.name === 'preview_storefront')
        expect(tool._meta).toMatchObject({
          ui: { resourceUri: BUILDER_PREVIEW_URI },
        });
      else expect(tool._meta).not.toHaveProperty('ui');
    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toEqual([
      BUILDER_PREVIEW_URI,
    ]);
    const resource = await client.readResource({ uri: BUILDER_PREVIEW_URI });
    const content = resource.contents[0];
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    expect(content._meta).toMatchObject({
      ui: { csp: { connectDomains: [], frameDomains: [] } },
    });
    expect('text' in content ? content.text : '').toContain('id="root"');
    expect(JSON.stringify(resource)).not.toMatch(
      /Task Zero|fixture-camera|actorUserId|connectionId/
    );
  } finally {
    await client.close();
    await server.close();
  }
});
