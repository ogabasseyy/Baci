import type { PlatformSettingsResponse } from '@/app/api/admin/settings/route';
import { PlatformSettingsUpdateSchema } from '@/app/api/admin/settings/schema';
import {
  buildPlatformSettingsUpdatePayload,
  type PlatformSettingsSecretInputs,
  type PlatformSettingsUpdatePayload,
} from './settings-payload';

export type PlatformSettingsFormErrors = Record<string, string[] | undefined>;

export function validatePlatformSettingsForm(
  settings: PlatformSettingsResponse,
  secretInputs: PlatformSettingsSecretInputs
):
  | { errors: PlatformSettingsFormErrors; success: false }
  | { payload: PlatformSettingsUpdatePayload; success: true } {
  const payload = buildPlatformSettingsUpdatePayload(settings, secretInputs);
  const parsed = PlatformSettingsUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, success: false };
  }
  return { payload, success: true };
}
