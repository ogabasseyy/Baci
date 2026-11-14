import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';

const request = z.strictObject({
  url: z.string().max(2048),
  method: z.enum(['GET', 'POST']),
  body: z.string().max(8192).optional(),
});
const frame = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('request'),
    id: z.number().int().min(1).max(64),
    request,
  }),
  z.strictObject({ type: z.literal('done'), observation: z.unknown() }),
]);

/** Host-side framing only; it does not start a sandbox or grant network access. */
export async function runPublicCartChannel(settings: {
  input: Readable;
  output: Writable;
  timeoutMs?: number;
  session(
    input: z.infer<typeof request>
  ): Promise<{ status: number; body: string }>;
}) {
  let buffered = Buffer.alloc(0);
  let expected = 1;
  let outputBytes = 0;
  let inputBytes = 0;
  let done = false;
  let observation: unknown;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    settings.input.destroy(Error('PUBLIC_CART_CHANNEL_TIMEOUT'));
  }, settings.timeoutMs ?? 60000);
  try {
    for await (const part of settings.input) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      inputBytes += chunk.length;
      if (chunk.length > 65536 || inputBytes > 1048576) throw Error();
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        const newline = buffered.indexOf(10);
        if (newline < 0) break;
        if (newline > 16384 || done) throw Error();
        const raw = buffered.subarray(0, newline);
        buffered = buffered.subarray(newline + 1);
        const message = frame.parse(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
        );
        if (message.type === 'done') {
          done = true;
          observation = message.observation;
          continue;
        }
        if (message.id !== expected++) throw Error();
        const result = await settings.session(message.request);
        if (
          timedOut ||
          !Number.isInteger(result.status) ||
          result.status < 200 ||
          result.status >= 300 ||
          typeof result.body !== 'string' ||
          Buffer.byteLength(result.body) > 1048576
        )
          throw Error();
        const encoded = `${JSON.stringify({ type: 'response', id: message.id, status: result.status, body: result.body })}\n`;
        outputBytes += Buffer.byteLength(encoded);
        if (outputBytes > 8388608) throw Error();
        await new Promise<void>((resolve, reject) =>
          settings.output.write(encoded, (error) =>
            error ? reject(error) : resolve()
          )
        );
      }
      if (buffered.length > 16384) throw Error();
    }
    if (timedOut || !done || buffered.length) throw Error();
    return observation;
  } catch {
    throw Error('PUBLIC_CART_CHANNEL_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
