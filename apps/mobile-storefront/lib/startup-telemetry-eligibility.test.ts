import { shouldVerifyStartupTelemetry } from './startup-telemetry-eligibility';

const ready = {
  appInitialized: true,
  loaded: true,
  nativeIntroSettled: true,
  showSplash: false,
  storageReady: true,
  timedOut: false,
};

it('verifies telemetry after a successful startup handoff', () => {
  expect(shouldVerifyStartupTelemetry(ready)).toBe(true);
});

it.each([
  { showSplash: true },
  { timedOut: true },
  { nativeIntroSettled: false },
  { loaded: false },
  { appInitialized: false },
  { storageReady: false },
])('skips telemetry when startup is incomplete: %o', (override) => {
  expect(shouldVerifyStartupTelemetry({ ...ready, ...override })).toBe(false);
});
