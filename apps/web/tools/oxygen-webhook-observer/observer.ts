import { shape } from '../oxygen-manual-test/diagnostics';

export interface Observation {
  authentication: 'unverified';
  markerMatched: boolean;
  headerNames: string[];
  json: boolean;
  shape: unknown;
  states: Record<string, string>;
  bytes: number;
}
export async function observeWebhook(
  request: Request,
  options: { path: string; marker: string }
): Promise<{ status: number; observation?: Observation }> {
  if (new URL(request.url).pathname !== options.path) return { status: 404 };
  if (request.method !== 'POST') return { status: 405 };
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 262144) {
        await reader.cancel();
        return { status: 413 };
      }
      chunks.push(next.value);
    }
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  let json = true;
  try {
    body = JSON.parse(new TextDecoder().decode(combined));
  } catch {
    json = false;
  }
  const states: Record<string, string> = {};
  function collect(value: unknown, path: string[] = []) {
    if (!value || typeof value !== 'object' || path.length > 5) return;
    for (const [key, child] of Object.entries(value).slice(0, 50)) {
      if (!/^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/.test(key)) continue;
      if (/token|secret|signature|document|bvn|nin|otp|customer/i.test(key))
        continue;
      const next = [...path, key];
      if (
        /^(status|selfie_status|address_status|nin_status)$/.test(key) &&
        typeof child === 'string' &&
        /^(DONE|NOT_DONE|PROCESSING|PENDING|FAILED|SUCCESS)$/.test(child)
      ) {
        states[next.join('.')] = child;
      } else collect(child, next);
    }
  }
  collect(body);
  return {
    status: 200,
    observation: {
      authentication: 'unverified',
      markerMatched: request.headers.get('x-oxygen-probe') === options.marker,
      headerNames: [...request.headers.keys()].filter((name) =>
        /^[a-z0-9-]{1,64}$/.test(name)
      ),
      json,
      shape: json ? shape(body) : 'unparsed',
      states,
      bytes,
    },
  };
}
