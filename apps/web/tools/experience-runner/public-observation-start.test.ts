import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
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
  for (const value of ['{}\n', '{bad}\n', `${'x'.repeat(8388609)}\n`]) {
    const input = new PassThrough();
    const pending = readPublicObservationStart(input);
    input.end(value);
    await expect(pending).rejects.toThrow();
  }
});
