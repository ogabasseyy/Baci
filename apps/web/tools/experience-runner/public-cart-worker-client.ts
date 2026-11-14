import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';

const requestSchema = z.strictObject({
  url: z.string().max(2048),
  method: z.enum(['GET', 'POST']),
  body: z.string().max(8192).optional(),
});
const responseSchema = z.strictObject({
  type: z.literal('response'),
  id: z.number().int().min(1).max(64),
  status: z.number().int().min(200).max(299),
  body: z.string(),
});

/** Sandbox worker side of the fixed host channel. No cookies or host keys enter it. */
export function createPublicCartWorkerClient(settings: {
  input: Readable;
  output: Writable;
}) {
  const iterator = settings.input[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  let nextId = 1;
  let pending = false;
  let closed = false;
  let totalBytes = 0;
  const write = (value: unknown) =>
    new Promise<void>((resolve, reject) =>
      settings.output.write(`${JSON.stringify(value)}\n`, (error) =>
        error ? reject(error) : resolve()
      )
    );
  const read = async () => {
    for (;;) {
      const end = buffered.indexOf(10);
      if (end >= 0) {
        if (end > 2097216) throw Error();
        const line = buffered.subarray(0, end);
        buffered = buffered.subarray(end + 1);
        return responseSchema.parse(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
        );
      }
      const part = await iterator.next();
      if (part.done) throw Error();
      const chunk = Buffer.isBuffer(part.value)
        ? part.value
        : Buffer.from(part.value);
      totalBytes += chunk.length;
      if (totalBytes > 8388608) throw Error();
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > 2097217) throw Error();
    }
  };
  return {
    async request(input: z.infer<typeof requestSchema>) {
      if (closed || pending || nextId > 64)
        throw Error('PUBLIC_CART_CLIENT_UNAVAILABLE');
      const validated = requestSchema.parse(input);
      const id = nextId++;
      pending = true;
      const timer = setTimeout(
        () => settings.input.destroy(Error('PUBLIC_CART_CLIENT_TIMEOUT')),
        15000
      );
      try {
        await write({ type: 'request', id, request: validated });
        const response = await read();
        if (response.id !== id || Buffer.byteLength(response.body) > 1048576)
          throw Error();
        return { status: response.status, body: response.body };
      } catch {
        closed = true;
        throw Error('PUBLIC_CART_CLIENT_FAILED');
      } finally {
        clearTimeout(timer);
        pending = false;
      }
    },
    async finish(observation: unknown) {
      if (closed || pending) throw Error('PUBLIC_CART_CLIENT_UNAVAILABLE');
      closed = true;
      const line = JSON.stringify({ type: 'done', observation });
      if (Buffer.byteLength(line) > 16384)
        throw Error('PUBLIC_CART_CLIENT_OUTPUT_BUDGET');
      await new Promise<void>((resolve, reject) =>
        settings.output.end(`${line}\n`, (error?: Error | null) =>
          error ? reject(error) : resolve()
        )
      );
      settings.input.destroy();
    },
  };
}
