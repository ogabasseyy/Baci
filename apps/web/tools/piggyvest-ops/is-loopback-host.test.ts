import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './is-loopback-host';

describe('isLoopbackHost', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['::1', true],
    ['127.0.0.1.example.com', false],
    ['db.example.com', false],
  ])('treats %s as loopback: %s', (host, loopback) => {
    expect(isLoopbackHost(host)).toBe(loopback);
  });
});
