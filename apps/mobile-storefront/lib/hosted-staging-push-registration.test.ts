import Constants from 'expo-constants';
import { getNativePushRegistration } from './hosted-staging-push-capability';

jest.mock('expo-application', () => ({
  applicationId: 'com.ogabassey.oxygenstaging',
}));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
jest.mock('./storefront-telemetry-excluded', () => ({
  isStorefrontTelemetryExcluded: () => false,
}));
it('does not attempt push registration in a local build with no EAS project', () => {
  expect(getNativePushRegistration()).toBeNull();
});
it('retains push registration for a configured project', () => {
  Object.assign(Constants.expoConfig ?? {}, {
    extra: { eas: { projectId: '22222222-2222-4222-8222-222222222222' } },
  });
  expect(getNativePushRegistration()).toEqual({
    projectId: '22222222-2222-4222-8222-222222222222',
  });
});
