import type { ExperienceCompositionSettings } from './lib/experience/compose-runtime';
import { validateExperienceProfile } from './lib/experience/profile-validation';

let selected: ExperienceCompositionSettings | undefined;
let pending: Promise<void> | undefined;
let cleanup: (() => void) | undefined;
/** Called only by a trusted local operator/test harness, never inferred from env. */
export function configureLocalExperienceBoot(
  settings: ExperienceCompositionSettings
) {
  if (settings.profile !== 'local-synthetic')
    throw Error('INVALID_LOCAL_PROFILE');
  return configureExperienceBoot(settings);
}
/** Explicit trusted production composition; feature gates remain independently required.
 * No environment discovery, infrastructure provisioning or automatic activation. */
export function configureProductionExperienceBoot(
  settings: ExperienceCompositionSettings
) {
  if (settings.profile !== 'production')
    throw Error('INVALID_PRODUCTION_PROFILE');
  return configureExperienceBoot(settings);
}
function configureExperienceBoot(settings: ExperienceCompositionSettings) {
  validateExperienceProfile(settings);
  if (selected) throw Error('PROFILE_ALREADY_CONFIGURED');
  selected = settings;
  return () => {
    if (selected !== settings) return;
    cleanup?.();
    cleanup = undefined;
    selected = undefined;
    pending = undefined;
  };
}
export async function registerExperienceStartup() {
  if (!selected) return;
  if (pending) return await pending;
  const settings = selected;
  pending = import('./lib/experience/compose-runtime')
    .then(({ composeExperienceRuntime }) => {
      if (selected === settings) cleanup = composeExperienceRuntime(settings);
    })
    .catch(() => {
      cleanup?.();
      cleanup = undefined;
      pending = undefined;
    });
  return await pending;
}
