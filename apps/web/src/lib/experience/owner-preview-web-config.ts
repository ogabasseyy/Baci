import 'server-only';
import { BUILDER_OWNER_PREVIEW_ENABLED } from '@/config/builder-owner-preview';
import { createOwnerPreviewBridgeClient } from './owner-preview-bridge-client';
import { productionDeliveryOrigins } from './production-origins';

type Settings = {
  enabled: boolean;
  key?: string;
  executionOrigin?: string;
  previewOrigin?: string;
};

/** Invalid or incomplete release configuration never installs a preview client. */
export function configuredOwnerPreview(settings: Settings) {
  if (!settings.enabled) return undefined;
  try {
    if (
      !settings.key ||
      !/^[A-Za-z0-9_-]{43}$/.test(settings.key) ||
      !settings.executionOrigin ||
      !settings.previewOrigin
    )
      return undefined;
    const key = Buffer.from(settings.key, 'base64url');
    if (key.length !== 32 || key.toString('base64url') !== settings.key)
      return undefined;
    productionDeliveryOrigins({
      executionOrigin: settings.executionOrigin,
      hostOrigins: [settings.previewOrigin],
    });
    return createOwnerPreviewBridgeClient({
      key,
      executionOrigin: settings.executionOrigin,
    });
  } catch {
    return undefined;
  }
}

/** Evaluated in the route process; a serverless worker need not share boot state. */
export function getConfiguredOwnerPreview() {
  if (!BUILDER_OWNER_PREVIEW_ENABLED) return undefined;
  return configuredOwnerPreview({
    enabled: true,
    key: process.env.BACI_OWNER_PREVIEW_BRIDGE_KEY,
    executionOrigin: process.env.BACI_EXPERIENCE_EXECUTION_ORIGIN,
    previewOrigin: process.env.BACI_OWNER_PREVIEW_ORIGIN,
  });
}
