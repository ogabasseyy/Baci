import type { Readable } from 'node:stream';
import { publicObservationStartFrame } from '@/schemas/experience-public-observation-payload';
import { MAX_PUBLIC_OBSERVATION_START_BYTES } from './public-observation-resource-limit';

/** Read one start frame without consuming subsequent host replies. */
export function readPublicObservationStart(input: Readable): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
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
      const end = data.indexOf(10);
      length += end < 0 ? data.length : end;
      if (length > MAX_PUBLIC_OBSERVATION_START_BYTES) return fail();
      chunks.push(end < 0 ? data : data.subarray(0, end));
      if (end < 0) return;
      try {
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks, length)
          )
        );
        if (
          !value ||
          typeof value !== 'object' ||
          !Object.hasOwn(value, 'payload')
        )
          throw Error();
        const parsed = publicObservationStartFrame.parse(value);
        input.pause();
        clean();
        const rest = data.subarray(end + 1);
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
