import { describe, expect, it } from 'vitest';
import { runChatwootCheckoutSerially } from './chatwoot-checkout-in-flight';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets queued promise callbacks run. */
const settle = () => new Promise<void>((done) => setTimeout(done, 0));

describe('runChatwootCheckoutSerially', () => {
  it('starts a second task for the same key only after the first settles', async () => {
    const gate = deferred();
    const events: string[] = [];
    const first = runChatwootCheckoutSerially('order-key', async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
    });
    const second = runChatwootCheckoutSerially('order-key', async () => {
      events.push('second:start');
    });

    await settle();
    expect(events).toEqual(['first:start']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not make different keys wait for each other', async () => {
    const gate = deferred();
    const events: string[] = [];
    const slow = runChatwootCheckoutSerially('key-a', async () => {
      await gate.promise;
      events.push('a');
    });
    await runChatwootCheckoutSerially('key-b', async () => {
      events.push('b');
    });

    expect(events).toEqual(['b']);
    gate.resolve();
    await slow;
    expect(events).toEqual(['b', 'a']);
  });

  it('still runs the next task after an earlier one throws', async () => {
    const failed = runChatwootCheckoutSerially('throwing-key', async () => {
      throw new Error('boom');
    });
    const events: string[] = [];
    const next = runChatwootCheckoutSerially('throwing-key', async () => {
      events.push('ran');
    });

    await expect(failed).rejects.toThrow('boom');
    await next;
    expect(events).toEqual(['ran']);
  });
});
