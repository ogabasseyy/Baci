// @vitest-environment node
import { expect, it } from 'vitest';
import config from './vite.config';

it('keeps the simulation bound to loopback without loading env files', () => {
  expect(config.envDir).toBe(false);
  expect(config.server?.host).toBe('127.0.0.1');
  expect(config.server?.port).toBe(3432);
  expect(config.server?.strictPort).toBe(true);
  expect(config.resolve?.dedupe).toEqual(['react', 'react-dom']);
});
