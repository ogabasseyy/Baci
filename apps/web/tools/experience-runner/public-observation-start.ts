import type { Readable } from 'node:stream';
import { z } from 'zod';

const startFrame = z.strictObject({
  type: z.literal('start'),
  payload: z.unknown(),
});

/** Read one start frame without consuming subsequent host replies. */
export function readPublicObservationStart(input: Readable): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const timer = setTimeout(() => fail(), 10000);
    const clean = () => {
      clearTimeout(timer);
      input.off('data', onData);
      input.off('end', fail);
      input.off('error', fail);
    };
    const fail = () => {
      input.pause();
      clean();
      reject(Error('PUBLIC_OBSERVATION_START_INVALID'));
    };
    const onData = (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes = Buffer.concat([bytes, data]);
      const end = bytes.indexOf(10);
      if ((end < 0 && bytes.length > 8388608) || end > 8388608) return fail();
      if (end < 0) return;
      try {
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            bytes.subarray(0, end)
          )
        );
        if (
          !value ||
          typeof value !== 'object' ||
          !Object.hasOwn(value, 'payload')
        )
          throw Error();
        const parsed = startFrame.parse(value);
        input.pause();
        clean();
        const rest = bytes.subarray(end + 1);
        if (rest.length) input.unshift(rest);
        resolve(parsed.payload);
      } catch {
        fail();
      }
    };
    input.on('data', onData);
    input.once('end', fail);
    input.once('error', fail);
    input.resume();
  });
}
