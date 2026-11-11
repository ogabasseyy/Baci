import { expect, it } from 'vitest';
import {
  getExperienceExecutionOrigin,
  installExperienceExecutionOrigin,
} from './execution-origin-runtime';

it('installs one trusted origin, rejects replacement, and removes only its own slot', () => {
  const uninstall = installExperienceExecutionOrigin(
    'https://execution.example.net'
  );
  try {
    expect(getExperienceExecutionOrigin()).toBe(
      'https://execution.example.net'
    );
    expect(() =>
      installExperienceExecutionOrigin('https://other.example.org')
    ).toThrow('ALREADY_INSTALLED');
  } finally {
    uninstall();
  }
  expect(getExperienceExecutionOrigin()).toBeUndefined();
  expect(() => installExperienceExecutionOrigin('http://localhost')).toThrow();
});
