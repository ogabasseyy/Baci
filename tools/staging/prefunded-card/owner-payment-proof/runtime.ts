import { createHash } from 'node:crypto';
import { collectFirstCardOwnerProof } from './collect';

type Input = Parameters<typeof collectFirstCardOwnerProof>[0];

export async function captureFirstCardOwnerProof(input: Input) {
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;
  let requests = 0;
  const proof = await collectFirstCardOwnerProof({
    ...input,
    fetchImplementation: async (url, options) => {
      requests += 1;
      if (requests !== 1 || options?.method !== 'GET')
        throw new Error('Owner proof request refused');
      const response = await input.fetchImplementation(url, options);
      if (!response.ok || response.redirected || !response.body)
        throw new Error('Owner proof response refused');
      const stream = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            length += chunk.byteLength;
            if (length > 65_536)
              throw new Error('Owner proof response too large');
            chunks.push(chunk.slice());
            controller.enqueue(chunk);
          },
          flush() {
            complete = true;
          },
        })
      );
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });
  if (!complete || requests !== 1)
    throw new Error('Owner proof response incomplete');
  const bytes = Buffer.concat(chunks);
  const rawResponse = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(rawResponse);
  if (!parsed || typeof parsed !== 'object' || !('data' in parsed))
    throw new Error('Owner proof payout timestamp unavailable');
  const data = parsed.data;
  if (!data || typeof data !== 'object' || !('paidAt' in data))
    throw new Error('Owner proof payout timestamp unavailable');
  const paidAt = data.paidAt;
  if (
    typeof paidAt !== 'string' ||
    !paidAt.endsWith('Z') ||
    !Number.isFinite(Date.parse(paidAt)) ||
    Date.parse(paidAt) > Date.parse(proof.verifiedAt)
  )
    throw new Error('Owner proof payout timestamp unavailable');
  return {
    ...proof,
    paidAt,
    responseSha256: createHash('sha256').update(bytes).digest('hex'),
    rawResponse,
  };
}
