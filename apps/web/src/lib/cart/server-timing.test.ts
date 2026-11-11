import { describe, expect, it } from 'vitest';
import { createCartServerTimer } from './server-timing';

function clock(...readings: number[]) {
  let index = 0;
  return () => readings[Math.min(index++, readings.length - 1)];
}

describe('cart server timing', () => {
  it('reports each step in order plus the total', async () => {
    // start, auth start/end, cart start/end, apply
    const timer = createCartServerTimer(clock(0, 1, 41.26, 50, 170, 175));
    await expect(timer.measure('auth', async () => 'a')).resolves.toBe('a');
    await expect(timer.measure('cart', () => 7)).resolves.toBe(7);
    const response = timer.apply(new Response(null));
    expect(response.headers.get('Server-Timing')).toBe(
      'auth;dur=40.3, cart;dur=120.0, total;dur=175.0'
    );
  });

  it('records a step that throws and rethrows the error', async () => {
    const timer = createCartServerTimer(clock(0, 10, 30, 35));
    await expect(
      timer.measure('quota', async () => {
        throw new Error('down');
      })
    ).rejects.toThrow('down');
    expect(timer.apply(new Response(null)).headers.get('Server-Timing')).toBe(
      'quota;dur=20.0, total;dur=35.0'
    );
  });

  it('never reports a negative duration', async () => {
    const timer = createCartServerTimer(clock(100, 100, 90, 80));
    await timer.measure('cart', () => null);
    expect(timer.apply(new Response(null)).headers.get('Server-Timing')).toBe(
      'cart;dur=0.0, total;dur=0.0'
    );
  });

  it('keeps timing entries already on the response', async () => {
    const timer = createCartServerTimer(clock(0, 5, 25, 30));
    await timer.measure('cart', () => null);
    const response = timer.apply(
      new Response(null, { headers: { 'Server-Timing': 'edge;dur=3.0' } })
    );
    expect(response.headers.get('Server-Timing')).toBe(
      'edge;dur=3.0, cart;dur=20.0, total;dur=30.0'
    );
  });

  it('rejects step names that are not fixed tokens', async () => {
    const timer = createCartServerTimer();
    await expect(timer.measure('bad name;x=1', () => null)).rejects.toThrow(
      'Invalid cart timing step name'
    );
    // Reserved for the entry apply() adds, so a header never has two totals.
    await expect(timer.measure('total', () => null)).rejects.toThrow(
      'Invalid cart timing step name'
    );
  });
});
