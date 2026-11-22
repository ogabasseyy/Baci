import Constants from 'expo-constants';
import { getNativePushRegistration } from './hosted-staging-push-capability';

jest.mock('expo-application', () => ({
  applicationId: 'com.ogabassey.oxygenstaging',
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
jest.mock('./storefront-telemetry-excluded', () => ({
  isStorefrontTelemetryExcluded: () => false,
}));
it('disables push for isolated Oxygen regardless of available project metadata', () => {
  const previous = process.env.EXPO_PUBLIC_OXYGEN_STAGING;
  process.env.EXPO_PUBLIC_OXYGEN_STAGING = '1';
  try {
    expect(getNativePushRegistration()).toBeNull();
    Object.assign(Constants.expoConfig ?? {}, {
      extra: { eas: { projectId: '22222222-2222-4222-8222-222222222222' } },
    });
    expect(getNativePushRegistration()).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_OXYGEN_STAGING;
    else process.env.EXPO_PUBLIC_OXYGEN_STAGING = previous;
    Object.assign(Constants.expoConfig ?? {}, { extra: {} });
  }
});
it('preserves the Expo fallback when a regular build has no manifest project', () => {
  expect(getNativePushRegistration()).toEqual({ projectId: undefined });
});
it('retains push registration for a configured project', () => {
  Object.assign(Constants.expoConfig ?? {}, {
    extra: { eas: { projectId: '22222222-2222-4222-8222-222222222222' } },
  });
  expect(getNativePushRegistration()).toEqual({
    projectId: '22222222-2222-4222-8222-222222222222',
  });
});
