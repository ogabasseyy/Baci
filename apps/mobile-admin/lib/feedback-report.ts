import * as Application from 'expo-application';
import {
  getRuntimePlatform,
  getRuntimePlatformConstant,
  getRuntimePlatformVersion,
} from '@/config/runtime-platform';
import { apiClient } from './api-client';

export interface FeedbackDiagnostics {
  screen?: string;
  platform?: 'ios' | 'android' | 'web';
  appVersion?: string;
  device?: string;
}

const REPORTED_PLATFORMS = ['ios', 'android', 'web'] as const;

interface FeedbackReportResponse {
  id: string;
  emailed: boolean;
}

function describeDevice(os: string): string | undefined {
  if (os === 'android') {
    const model = [
      getRuntimePlatformConstant('Brand'),
      getRuntimePlatformConstant('Model'),
    ]
      .filter(Boolean)
      .join(' ');
    const release =
      getRuntimePlatformConstant('Release') ?? getRuntimePlatformVersion();
    return [model, `Android ${release}`].filter(Boolean).join(' · ');
  }
  if (os === 'ios') {
    return `iOS ${getRuntimePlatformVersion()}`;
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
  const os = getRuntimePlatform();
  const platform = REPORTED_PLATFORMS.find((candidate) => candidate === os);
  return {
    screen: screen?.trim() || undefined,
    platform,
    appVersion: describeAppVersion(),
    device: describeDevice(os),
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
