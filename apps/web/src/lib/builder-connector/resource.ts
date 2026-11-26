export const BUILDER_ISSUER = 'https://builder-auth.usebaci.com';
export const BUILDER_MCP_HOST = 'builder-mcp.usebaci.com';
export const BUILDER_MCP_ORIGIN = `https://${BUILDER_MCP_HOST}`;
export const BUILDER_MCP_PATH = '/builder/mcp';
export const BUILDER_METADATA_PATH =
  '/.well-known/oauth-protected-resource/builder/mcp';

export const BUILDER_RESOURCE = `${BUILDER_MCP_ORIGIN}${BUILDER_MCP_PATH}`;
export const BUILDER_METADATA_URL = `${BUILDER_MCP_ORIGIN}${BUILDER_METADATA_PATH}`;
