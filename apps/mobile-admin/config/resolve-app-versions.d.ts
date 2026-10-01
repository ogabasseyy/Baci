export const DEFAULT_APP_VERSION: string;

export function resolveAndroidVersionCode(
  rawAndroidVersionCode: string | undefined
): number | undefined;

export function resolveIosBuildNumber(
  rawIosBuildNumber: string | undefined
): string | undefined;

export function resolveAppVersion(
  environment?: Readonly<Record<string, string | undefined>>
): string | undefined;
