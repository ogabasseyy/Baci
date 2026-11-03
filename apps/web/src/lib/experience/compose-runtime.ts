import { validateExperienceProfile } from './profile-validation';

export { validateExperienceProfile } from './profile-validation';

import type { BuilderIdentity } from '@/lib/builder-connector/types';
import type { BuilderGatewayHandler } from '@/lib/builder-gateway/gateway';
import { installBuilderGateway } from '@/lib/builder-gateway/runtime';
import { isImplementedBuilderTool } from '@/schemas/builder-implemented-tools';
import { experienceError } from '@/schemas/experience-tool-results';
import { isExperienceTool } from '@/schemas/experience-tools';
import { createExperienceEvidenceReader } from './evidence-read';
import { installExperienceEvidenceReader } from './evidence-runtime';
import { installExperienceExecutionOrigin } from './execution-origin-runtime';
import { installLocalExperienceAdmission } from './local-profile';
import {
  type ExperienceOwnerRuntime,
  installExperienceOwnerRuntime,
} from './owner-runtime';
import {
  type ExperienceStorefrontRuntime,
  installExperienceStorefrontRuntime,
} from './storefront-runtime';
import {
  createExperienceToolDispatcher,
  type ExperienceDispatcherDependencies,
} from './tool-dispatcher';
import { createExperienceGateway } from './tool-gateway';
export interface ExperienceCompositionSettings {
  profile: 'local-synthetic' | 'production';
  hostOrigin: string;
  runtimeBase: string;
  authenticate(request: Request): Promise<BuilderIdentity>;
  legacyGateway: BuilderGatewayHandler;
  dispatcher: ExperienceDispatcherDependencies;
  owner: ExperienceOwnerRuntime;
  storefront: ExperienceStorefrontRuntime;
}
/** All factories receive explicit normal-user/public clients; no provider or env factory. */
export function composeExperienceRuntime(
  settings: ExperienceCompositionSettings
) {
  validateExperienceProfile(settings);
  const cleanups: Array<() => void> = [];
  try {
    if (settings.profile === 'production')
      cleanups.push(installExperienceExecutionOrigin(settings.runtimeBase));
    const experience = createExperienceGateway({
      authenticate: settings.authenticate,
      execute: createExperienceToolDispatcher(settings.dispatcher),
    });
    cleanups.push(
      installBuilderGateway((request, name) =>
        isExperienceTool(name)
          ? experience(request, name)
          : isImplementedBuilderTool(name)
            ? settings.legacyGateway(request, name)
            : Promise.resolve(
                Response.json(experienceError('NOT_FOUND'), { status: 404 })
              )
      )
    );
    cleanups.push(
      installExperienceOwnerRuntime(
        settings.dispatcher.readPerformance
          ? {
              ...settings.owner,
              readPerformance: settings.dispatcher.readPerformance,
            }
          : settings.owner
      )
    );
    cleanups.push(installExperienceStorefrontRuntime(settings.storefront));
    cleanups.push(
      installExperienceEvidenceReader(
        createExperienceEvidenceReader({
          authenticate: settings.authenticate,
          resolveUserClient: settings.dispatcher.resolveUserClient,
        })
      )
    );
    if (settings.profile === 'local-synthetic')
      cleanups.push(installLocalExperienceAdmission());
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const cleanup of cleanups.reverse()) cleanup();
    };
  } catch (e) {
    for (const cleanup of cleanups.reverse()) cleanup();
    throw e;
  }
}
