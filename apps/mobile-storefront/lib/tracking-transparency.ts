import { Platform } from 'react-native';
import { isStorefrontTelemetryExcluded } from './storefront-telemetry-excluded';

type TrackingTransparencyPermission = {
  status: string;
};

type TrackingTransparencyModule = {
  getTrackingPermissionsAsync?: () => Promise<TrackingTransparencyPermission>;
  requestTrackingPermissionsAsync?: () => Promise<TrackingTransparencyPermission>;
};

let trackingTransparencyModulePromise: Promise<TrackingTransparencyModule> | null =
  null;

function loadTrackingTransparency() {
  trackingTransparencyModulePromise ??= import(
    'expo-tracking-transparency'
  ).catch((error: unknown) => {
    trackingTransparencyModulePromise = null;
    throw error;
  });

  return trackingTransparencyModulePromise;
}

async function tryLoadTrackingTransparency(): Promise<TrackingTransparencyModule | null> {
  try {
    return await loadTrackingTransparency();
  } catch {
    return null;
  }
}

export function canRequestTrackingTransparency(): boolean {
  return Platform.OS === 'ios' && !isStorefrontTelemetryExcluded();
}

export async function getTrackingPermissionStatus(): Promise<TrackingTransparencyPermission> {
  // Sanitized QA builds omit the native tracking usage description. Even a
  // permission read can terminate iOS; never load ATT or imply consent there.
  if (isStorefrontTelemetryExcluded()) return { status: 'denied' };
  if (!canRequestTrackingTransparency()) {
    return { status: 'granted' };
  }

  const trackingTransparency = await tryLoadTrackingTransparency();

  if (!trackingTransparency?.getTrackingPermissionsAsync) {
    return { status: 'undetermined' };
  }

  try {
    return await trackingTransparency.getTrackingPermissionsAsync();
  } catch {
    return { status: 'undetermined' };
  }
}

export async function requestTrackingPermissionStatus(): Promise<TrackingTransparencyPermission> {
  // Sanitized QA builds omit the native tracking usage description. Even a
  // permission read can terminate iOS; never load ATT or imply consent there.
  if (isStorefrontTelemetryExcluded()) return { status: 'denied' };
  if (!canRequestTrackingTransparency()) {
    return { status: 'granted' };
  }

  const trackingTransparency = await tryLoadTrackingTransparency();

  if (!trackingTransparency?.requestTrackingPermissionsAsync) {
    return { status: 'denied' };
  }

  try {
    return await trackingTransparency.requestTrackingPermissionsAsync();
  } catch {
    return { status: 'denied' };
  }
}
