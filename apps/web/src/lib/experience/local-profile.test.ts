import { afterEach, expect, it, vi } from 'vitest';
import {
  allowsLocalExperienceRequest,
  installLocalExperienceAdmission,
} from './local-profile';

afterEach(() => vi.unstubAllEnvs());

const loopback = new Request('http://127.0.0.1:43174/builder/mcp');

it('rejects uninstalled and production requests even on loopback', () => {
  vi.stubEnv('NODE_ENV', 'test');
  expect(allowsLocalExperienceRequest(loopback)).toBe(false);
  const cleanup = installLocalExperienceAdmission();
  try {
    vi.stubEnv('NODE_ENV', 'production');
    expect(allowsLocalExperienceRequest(loopback)).toBe(false);
    expect(installLocalExperienceAdmission).toThrow('INVALID_LOCAL_PROFILE');
  } finally {
    cleanup();
  }
  expect(installLocalExperienceAdmission).toThrow('INVALID_LOCAL_PROFILE');
});

it('admits only HTTP loopback URLs during a single local installation', () => {
  vi.stubEnv('NODE_ENV', 'test');
  const cleanup = installLocalExperienceAdmission();
  try {
    expect(installLocalExperienceAdmission).toThrow('INVALID_LOCAL_PROFILE');
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(
        allowsLocalExperienceRequest(new Request(`http://${host}:43174/mcp`))
      ).toBe(true);
    }
    for (const url of [
      'https://localhost:43174/mcp',
      'http://localhost.example.test/mcp',
      'http://127.0.0.2/mcp',
      'http://remote.example.test/mcp?host=localhost',
    ]) {
      expect(allowsLocalExperienceRequest(new Request(url))).toBe(false);
    }
  } finally {
    cleanup();
  }
  expect(allowsLocalExperienceRequest(loopback)).toBe(false);
  const cleanupReplacement = installLocalExperienceAdmission();
  try {
    cleanup();
    expect(allowsLocalExperienceRequest(loopback)).toBe(true);
  } finally {
    cleanupReplacement();
  }
});
