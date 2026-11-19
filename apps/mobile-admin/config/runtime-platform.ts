import { Platform } from 'react-native';

export type RuntimePlatform = 'android' | 'ios' | 'web' | (string & {});

interface PlatformSelection<T> {
  android?: T;
  default?: T;
  ios?: T;
  web?: T;
}

export function getRuntimePlatform(): RuntimePlatform {
  return Platform.OS as RuntimePlatform;
}

/** OS version as reported by React Native (iOS string, Android API level). */
export function getRuntimePlatformVersion(): string {
  return String(Platform.Version);
}

/** A non-empty string from the native platform constants (e.g. Android Model). */
export function getRuntimePlatformConstant(key: string): string | undefined {
  const constants = Platform.constants as unknown as
    | Record<string, unknown>
    | undefined;
  const value = constants?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isRuntimePlatform(platform: RuntimePlatform): boolean {
  return getRuntimePlatform() === platform;
}

export function selectRuntimePlatform<T>(
  options: PlatformSelection<T>,
  platform: RuntimePlatform = getRuntimePlatform()
): T | undefined {
  if (platform === 'ios') {
    return options.ios ?? options.default;
  }

  if (platform === 'android') {
    return options.android ?? options.default;
  }

  if (platform === 'web') {
    return options.web ?? options.default;
  }

  return options.default;
}
