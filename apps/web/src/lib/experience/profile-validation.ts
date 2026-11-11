import type { ExperienceCompositionSettings } from './compose-runtime';
import { productionDeliveryOrigins } from './production-origins';

export function validateExperienceProfile(
  settings: ExperienceCompositionSettings
) {
  if (
    !['local-synthetic', 'production'].includes(settings.profile) ||
    (settings.profile === 'local-synthetic' &&
      process.env.NODE_ENV === 'production')
  )
    throw Error('PROFILE_DISABLED');
  if (settings.profile === 'production') {
    productionDeliveryOrigins({
      executionOrigin: settings.runtimeBase,
      hostOrigins: [settings.hostOrigin],
    });
  } else
    for (const value of [settings.hostOrigin, settings.runtimeBase]) {
      const u = new URL(value);
      if (
        u.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash
      )
        throw Error('LOCAL_ORIGIN_REQUIRED');
    }
  if (
    !settings.owner.approval?.loadLifecycle ||
    !settings.owner.approval.confirmPublication ||
    !settings.owner.approval.confirmModeExit ||
    !settings.dispatcher.finalizeBuild ||
    !settings.dispatcher.preview
  )
    throw Error('INCOMPLETE_RUNTIME');
}
