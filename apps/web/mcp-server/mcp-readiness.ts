/** Legacy catalog-only instances remain independent of guest cart storage.
 * OAuth instances cannot serve any MCP request once their worker expires. */
export function mcpReadiness(merchantAvailable: boolean, worker?: string) {
  const ready = merchantAvailable && worker !== 'expired';
  return { statusCode: ready ? 200 : 503, status: ready ? 'healthy' : 'unhealthy' } as const;
}
