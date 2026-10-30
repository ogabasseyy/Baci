import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { apiClient } from './api-client';

export interface FeedbackDiagnostics {
  screen?: string;
  platform?: 'ios' | 'android' | 'web';
  appVersion?: string;
  device?: string;
}

interface FeedbackReportResponse {
  id: string;
  emailed: boolean;
}

function readConstant(key: string): string | undefined {
  const constants = Platform.constants as unknown as Record<string, unknown>;
  const value = constants?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function describeDevice(): string | undefined {
  if (Platform.OS === 'android') {
    const model = [readConstant('Brand'), readConstant('Model')]
      .filter(Boolean)
      .join(' ');
    const release = readConstant('Release') ?? String(Platform.Version);
    return [model, `Android ${release}`].filter(Boolean).join(' · ');
  }
  if (Platform.OS === 'ios') {
    return `iOS ${String(Platform.Version)}`;
  }
  return undefined;
}

function describeAppVersion(): string | undefined {
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  if (!version) return undefined;
  return build ? `${version} (${build})` : version;
}

/** Where the merchant was and what they were running when they sent feedback. */
export function collectFeedbackDiagnostics(
  screen: string | null | undefined
): FeedbackDiagnostics {
  const platform =
    Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
      ? Platform.OS
      : undefined;
  return {
    screen: screen?.trim() || undefined,
    platform,
    appVersion: describeAppVersion(),
    device: describeDevice(),
  };
}

/** Sends one feedback report; the server saves it and emails Baci support. */
export function sendFeedbackReport(
  message: string,
  diagnostics: FeedbackDiagnostics
): Promise<FeedbackReportResponse> {
  return apiClient<FeedbackReportResponse>('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ message: message.trim(), ...diagnostics }),
  });
}
