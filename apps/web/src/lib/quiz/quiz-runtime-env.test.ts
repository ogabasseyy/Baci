import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getQuizAppAttestationModeEnv,
  getQuizAppCheckConfigEnv,
  getQuizDeviceHashPepper,
  getQuizPhaseEnv,
  getQuizProductionApprovedEnv,
  getQuizRpcServerSecret,
  isProductionDeployment,
} from './quiz-runtime-env';

afterEach(() => vi.unstubAllEnvs());

describe('quiz runtime environment', () => {
  it('defaults to the fail-closed pre-production phase', () => {
    vi.stubEnv('QUIZ_PHASE', '');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', '');
    expect(getQuizPhaseEnv()).toBe('1a');
    expect(getQuizProductionApprovedEnv()).toBe(false);
  });

  it('normalizes valid production settings and trims secrets', () => {
    vi.stubEnv('QUIZ_PHASE', ' production ');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'YES');
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', ' quiz-secret ');
    vi.stubEnv('QUIZ_DEVICE_HASH_PEPPER', ` ${'p'.repeat(32)} `);
    expect(getQuizPhaseEnv()).toBe('production');
    expect(getQuizProductionApprovedEnv()).toBe(true);
    expect(getQuizRpcServerSecret()).toBe('quiz-secret');
    expect(getQuizDeviceHashPepper()).toBe('p'.repeat(32));
    vi.stubEnv('NODE_ENV', 'production');
    expect(isProductionDeployment()).toBe(true);
  });

  it('derives secure-cookie deployment state without consulting quiz phase', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('QUIZ_PHASE', 'production');
    expect(isProductionDeployment()).toBe(false);

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('QUIZ_PHASE', '1a');
    expect(isProductionDeployment()).toBe(true);
  });

  it('rejects malformed phase, approval, and short pepper values', () => {
    vi.stubEnv('QUIZ_PHASE', 'live');
    expect(() => getQuizPhaseEnv()).toThrow('must be 1a or production');

    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'maybe');
    expect(() => getQuizProductionApprovedEnv()).toThrow('must be one of');

    vi.stubEnv('QUIZ_DEVICE_HASH_PEPPER', 'short');
    expect(() => getQuizDeviceHashPepper()).toThrow(
      'must be at least 32 characters'
    );
  });

  it('defaults app attestation off and rejects unknown modes', () => {
    vi.stubEnv('QUIZ_APP_ATTESTATION', '');
    expect(getQuizAppAttestationModeEnv()).toBe('off');

    vi.stubEnv('QUIZ_APP_ATTESTATION', ' Monitor '.trim().toLowerCase());
    expect(getQuizAppAttestationModeEnv()).toBe('monitor');

    vi.stubEnv('QUIZ_APP_ATTESTATION', 'on');
    expect(() => getQuizAppAttestationModeEnv()).toThrow(
      'must be off, monitor or enforce'
    );
  });

  it('parses the App Check project number and trims the app id list', () => {
    vi.stubEnv('QUIZ_APP_CHECK_PROJECT_NUMBER', ' 499767419832 ');
    vi.stubEnv('QUIZ_APP_CHECK_APP_IDS', ' app-a , ,app-b ');
    expect(getQuizAppCheckConfigEnv()).toEqual({
      allowedAppIds: ['app-a', 'app-b'],
      projectNumber: '499767419832',
    });

    vi.stubEnv('QUIZ_APP_CHECK_PROJECT_NUMBER', '');
    vi.stubEnv('QUIZ_APP_CHECK_APP_IDS', '');
    expect(getQuizAppCheckConfigEnv()).toEqual({
      allowedAppIds: [],
      projectNumber: '',
    });
  });
});
