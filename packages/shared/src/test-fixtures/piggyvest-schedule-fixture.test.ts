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

  it('once queue is consumed in order and cleared by mockClear', async () => {
    const fn = createFixtureMock(async () => 'base');
    fn.mockResolvedValueOnce('once');
    await expect(fn()).resolves.toBe('once');
    await expect(fn()).resolves.toBe('base');
    fn.mockResolvedValueOnce('never');
    fn.mockClear();
    await expect(fn()).resolves.toBe('base');
    expect(fn.mock.calls).toHaveLength(1);
  });

  it('schedule fixture read/submit keep promise contracts', async () => {
    const fixture = scheduleJourneyFixture();
    await expect(fixture.read()).resolves.toBeDefined();
    expect(fixture.submit.mock.calls).toHaveLength(0);
  });
});
