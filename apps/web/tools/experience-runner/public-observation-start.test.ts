import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import { MAX_PUBLIC_OBSERVATION_START_BYTES } from './public-observation-resource-limit';
import { readPublicObservationStart } from './public-observation-start';

it('reads the bounded start frame and preserves bytes belonging to the duplex protocol', async () => {
  const input = new PassThrough();
  const pending = readPublicObservationStart(input);
  input.write('{"type":"start","payload":{"synthetic":true}}\nnext\n');
  await expect(pending).resolves.toEqual({ synthetic: true });
  expect(input.read().toString()).toBe('next\n');
  input.destroy();
});

it('rejects malformed, unexpected and oversized start frames', async () => {
  for (const value of ['{}\n', '{bad}\n']) {
    const input = new PassThrough();
    const pending = readPublicObservationStart(input);
    input.end(value);
    await expect(pending).rejects.toThrow();
  }
});

it('rejects an oversized start frame before decoding it', async () => {
  const input = new PassThrough();
  const pending = readPublicObservationStart(input);
  const chunk = Buffer.alloc(1024 ** 2, 'x');
  for (
    let written = 0;
    written < MAX_PUBLIC_OBSERVATION_START_BYTES;
    written += chunk.length
  )
    input.write(chunk);
  input.end('x\n');
  await expect(pending).rejects.toThrow('PUBLIC_OBSERVATION_START_INVALID');
});
