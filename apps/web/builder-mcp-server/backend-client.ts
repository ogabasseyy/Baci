import { builderError } from '../src/lib/builder-connector/errors';
import {
  type ImplementedBuilderTool,
  isImplementedBuilderTool,
} from '../src/schemas/builder-implemented-tools';
import { BUILDER_REQUEST_BYTES } from '../src/schemas/builder-mcp-primitives';

const MAX_RESPONSE = 131072;
/** Fixed Baci origin/path only. Config supplies fetch plumbing, never an argument-selected URL. */
export function createBuilderBackendClient(
  deps: { fetchImpl?: typeof fetch } = {}
) {
  return async (
    token: string,
    tool: ImplementedBuilderTool,
    input: unknown,
    signal?: AbortSignal
  ): Promise<unknown> => {
    if (
      !isImplementedBuilderTool(tool) ||
      !token ||
      token.length > 8192 ||
      !/^[A-Za-z0-9_.-]+$/.test(token)
    )
      throw new Error('Invalid backend request');
    const body = JSON.stringify(input);
    if (new TextEncoder().encode(body).byteLength > BUILDER_REQUEST_BYTES)
      throw new Error('Invalid backend request');
    const response = await (deps.fetchImpl ?? fetch)(
      `https://usebaci.com/api/integrations/chatgpt/builder/${tool}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.any([
          AbortSignal.timeout(25000),
          ...(signal ? [signal] : []),
        ]),
      }
    );
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error('Backend redirects forbidden');
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return builderError(
        response.status === 401 ? 'CONNECTION_REVOKED' : 'INSUFFICIENT_SCOPE'
      );
    }
    if (response.status === 429) {
      await response.body?.cancel();
      return builderError('RATE_LIMITED');
    }
    if (
      !response.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json') ||
      Number(response.headers.get('content-length')) > MAX_RESPONSE
    ) {
      await response.body?.cancel();
      throw new Error('Invalid backend response');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Invalid backend response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_RESPONSE) throw new Error('Backend response too large');
        chunks.push(next.value);
      }
    } catch {
      await reader.cancel().catch(() => undefined);
      throw new Error('Invalid backend response');
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      );
    } catch {
      throw new Error('Invalid backend response');
    }
  };
}
