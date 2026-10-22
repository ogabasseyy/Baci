import { McpServer } from '@modelcontextprotocol/server';
import { registerBuilderPreviewResource } from './preview-resource';
import { type BuilderMcpDependencies, registerBuilderTools } from './registry';
export function createBuilderMcpServer(deps: BuilderMcpDependencies) {
  const server = new McpServer({
    name: 'Baci website builder',
    version: '0.1.0',
  });
  registerBuilderTools(server, deps);
  registerBuilderPreviewResource(server);
  return server;
}
