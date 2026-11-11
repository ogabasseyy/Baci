import { describe, expect, it } from 'vitest';
import { createServerTimer } from './server-timing';

function clock(...readings: number[]) {
  let index = 0;
  return () => readings[Math.min(index++, readings.length - 1)];
}

describe('server timing', () => {
  it('reports each step in order plus the total on the default header', async () => {
    // start, first start/end, second start/end, apply
    const timer = createServerTimer({ now: clock(0, 1, 41.26, 50, 170, 175) });
    await expect(timer.measure('first', async () => 'a')).resolves.toBe('a');
    await expect(timer.measure('second', () => 7)).resolves.toBe(7);
    const response = timer.apply(new Response(null));
    expect(response.headers.get('Server-Timing')).toBe(
      'first;dur=40.3, second;dur=120.0, total;dur=175.0'
    );
  });

  it('writes to the header it is given and leaves Server-Timing alone', async () => {
    const timer = createServerTimer({
      header: 'x-test-timing',
      now: clock(0, 5, 9, 12),
    });
    await timer.measure('stage', () => null);
    const response = timer.apply(
      new Response(null, { headers: { 'Server-Timing': 'edge;dur=1' } })
    );
    expect(response.headers.get('x-test-timing')).toBe(
      'stage;dur=4.0, total;dur=12.0'
    );
    expect(response.headers.get('Server-Timing')).toBe('edge;dur=1');
  });

  it('records a step that throws and rethrows the error', async () => {
    const timer = createServerTimer({ now: clock(0, 10, 30, 35) });
    await expect(
      timer.measure('stage', async () => {
        throw new Error('down');
      })
    ).rejects.toThrow('down');
    expect(timer.apply(new Response(null)).headers.get('Server-Timing')).toBe(
      'stage;dur=20.0, total;dur=35.0'
    );
  });

  it('rejects invalid step names and the reserved total', async () => {
    const timer = createServerTimer();
    await expect(timer.measure('Bad Name', () => null)).rejects.toThrow(
      'Invalid timing step name'
    );
    await expect(timer.measure('total', () => null)).rejects.toThrow(
      'Invalid timing step name'
    );
  });

  it('returns a response with immutable headers unchanged instead of throwing', () => {
    const timer = createServerTimer({ now: clock(0, 3) });
    const frozen = Response.redirect('https://example.com/next', 308);
    expect(timer.apply(frozen)).toBe(frozen);
    expect(frozen.headers.get('Server-Timing')).toBeNull();
  });
});
