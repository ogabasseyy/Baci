import { describe, expect, it } from 'vitest';
import {
  createFixtureMock,
  scheduleJourneyFixture,
} from './piggyvest-schedule';

describe('createFixtureMock async semantics', () => {
  it('mockResolvedValue returns a real promise', async () => {
    const fn = createFixtureMock(async () => 'base');
    fn.mockResolvedValue('resolved');
    const result = fn();
    expect(typeof (result as Promise<string>).then).toBe('function');
    await expect(result).resolves.toBe('resolved');
  });

  it('mockRejectedValue returns a rejected promise, not a sync throw', async () => {
    const fn = createFixtureMock(async () => 'base');
    fn.mockRejectedValue(new Error('boom'));
    await expect(fn()).rejects.toThrow('boom');
  });

  it('mockClear keeps queued once values (runner semantics); mockReset drops them', async () => {
    const fn = createFixtureMock(async () => 'base');
    fn.mockResolvedValueOnce('once');
    await expect(fn()).resolves.toBe('once');
    await expect(fn()).resolves.toBe('base');
    fn.mockResolvedValueOnce('still-queued');
    fn.mockClear();
    expect(fn.mock.calls).toHaveLength(0);
    await expect(fn()).resolves.toBe('still-queued');
    fn.mockResolvedValueOnce('never');
    fn.mockReset();
    expect(fn()).toBeUndefined();
  });

  it('schedule fixture read/submit keep promise contracts', async () => {
    const fixture = scheduleJourneyFixture();
    await expect(fixture.read()).resolves.toBeDefined();
    expect(fixture.submit.mock.calls).toHaveLength(0);
  });
});
