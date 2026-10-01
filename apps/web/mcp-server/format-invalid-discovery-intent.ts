/** The MCP handler must mark structured contract rejections as tool errors. */
export function formatInvalidDiscoveryIntent(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { products: [], status: 'error' as const, message },
  };
}
