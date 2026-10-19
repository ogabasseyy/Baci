import { expect, it } from 'vitest';
import { resolveRuntimeJourneyBrowserConfiguration } from './runtime-journey-local-browser-config';

it.each([4181, 4183])('accepts explicitly pinned synthetic port %s', (port) => {
  expect(resolveRuntimeJourneyBrowserConfiguration(port)).toEqual({
    port,
    origin: `http://127.0.0.1:${port}`,
  });
});

it.each([
  undefined,
  4182,
  443,
  '4183',
  'http://remote.test',
])('rejects unapproved browser port %s', (port) => {
  expect(() => resolveRuntimeJourneyBrowserConfiguration(port)).toThrow(
    'Pinned synthetic browser port required'
  );
});
