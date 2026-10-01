import type { PlatformSettingsResponse } from '@/app/api/admin/settings/route';

export type EditablePlatformSettings = Omit<
  PlatformSettingsResponse,
  'id' | 'created_at' | 'updated_at' | 'secretStatus'
>;

export type PlatformSettingsUpdater = <
  K extends keyof EditablePlatformSettings,
>(
  key: K,
  value: EditablePlatformSettings[K]
) => void;
