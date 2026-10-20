/** Server-only candidate opt-in. Provisioning this flag requires owner approval. */
export function privateCartContinuationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env.BACI_MCP_PRIVATE_TEXT_CONTINUATION === 'true';
}
