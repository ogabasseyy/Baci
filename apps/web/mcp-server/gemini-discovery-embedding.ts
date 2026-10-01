const EMBEDDING_MODEL = 'gemini-embedding-2';
const EMBEDDING_DIMENSIONS = 768;

/** Query and document prefixes follow Gemini Embedding 2's asymmetric search guidance. */
export async function embedDiscoveryText({
  apiKey,
  fetchImpl = fetch,
  kind,
  text,
  title,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  kind: 'query' | 'document';
  text: string;
  title?: string;
}): Promise<number[]> {
  if (!apiKey || !text.trim()) throw new Error('Embedding credentials or text unavailable');
  const input = kind === 'query'
    ? `task: search result | query: ${text.slice(0, 500)}`
    : `title: ${(title || 'none').slice(0, 200)} | text: ${text.slice(0, 8000)}`;
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: input }] },
        output_dimensionality: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(5000),
    }
  );
  if (!response.ok) throw new Error(`Embedding provider returned ${response.status}`);
  const payload: unknown = await response.json();
  const values = payload && typeof payload === 'object' && 'embedding' in payload &&
    payload.embedding && typeof payload.embedding === 'object' &&
    'values' in payload.embedding ? payload.embedding.values : undefined;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS ||
    !values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('Embedding provider returned an invalid vector');
  }
  return values as number[];
}
