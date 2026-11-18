import { normalizeEnvBoolean } from '@/lib/env-boolean';

function assertServerRuntime(variable: string) {
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    throw new Error(`${variable} cannot be accessed on the client`);
  }
}

function trimmedRuntimeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function getQuizPhaseEnv(): '1a' | 'production' {
  assertServerRuntime('QUIZ_PHASE');
  const phase = trimmedRuntimeValue(process.env.QUIZ_PHASE) ?? '1a';
  if (phase === '1a' || phase === 'production') return phase;
  throw new Error('QUIZ_PHASE must be 1a or production');
}

export function getQuizProductionApprovedEnv(): boolean {
  assertServerRuntime('QUIZ_PRODUCTION_APPROVED');
  const configured = trimmedRuntimeValue(process.env.QUIZ_PRODUCTION_APPROVED);
  if (!configured) return false;
  const normalized = normalizeEnvBoolean(configured);
  if (normalized !== undefined) return normalized;
  throw new Error(
    'QUIZ_PRODUCTION_APPROVED must be one of true/false/1/0/yes/no'
  );
}

export type QuizAppAttestationMode = 'enforce' | 'monitor' | 'off';

/**
 * Rollout switch for requiring app attestation on live prize starts.
 * off (default): not checked. monitor: checked and logged, never blocks.
 * enforce: a live bearer start without a valid attestation is refused.
 */
export function getQuizAppAttestationModeEnv(): QuizAppAttestationMode {
  assertServerRuntime('QUIZ_APP_ATTESTATION');
  const mode = trimmedRuntimeValue(process.env.QUIZ_APP_ATTESTATION) ?? 'off';
  if (mode === 'off' || mode === 'monitor' || mode === 'enforce') return mode;
  throw new Error('QUIZ_APP_ATTESTATION must be off, monitor or enforce');
}

export function getQuizAppCheckConfigEnv(): {
  allowedAppIds: string[];
  projectNumber: string;
} {
  assertServerRuntime('QUIZ_APP_CHECK_PROJECT_NUMBER');
  return {
    allowedAppIds: (
      trimmedRuntimeValue(process.env.QUIZ_APP_CHECK_APP_IDS) ?? ''
    )
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    projectNumber:
      trimmedRuntimeValue(process.env.QUIZ_APP_CHECK_PROJECT_NUMBER) ?? '',
  };
}

export function getQuizRpcServerSecret(): string | undefined {
  assertServerRuntime('QUIZ_RPC_SERVER_SECRET');
  return trimmedRuntimeValue(process.env.QUIZ_RPC_SERVER_SECRET);
}

export function getQuizDeviceHashPepper(): string | undefined {
  assertServerRuntime('QUIZ_DEVICE_HASH_PEPPER');
  const pepper = trimmedRuntimeValue(process.env.QUIZ_DEVICE_HASH_PEPPER);
  if (pepper && pepper.length < 32) {
    throw new Error('QUIZ_DEVICE_HASH_PEPPER must be at least 32 characters');
  }
  return pepper;
}

/**
 * Cookies require HTTPS based on where this code is deployed, independently of
 * whether the quiz feature itself is in its production phase.
 */
export function isProductionDeployment(): boolean {
  return process.env.NODE_ENV === 'production';
}
