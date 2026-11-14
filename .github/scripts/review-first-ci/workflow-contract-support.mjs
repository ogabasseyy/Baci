// Shared by the workflow contract tests (test support, not production code).
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

export const read = (file) => readFileSync(new URL(`../../workflows/${file}`, import.meta.url), 'utf8');
export const ci = YAML.parse(read('ci.yml'));
export const browser = YAML.parse(read('checkout-browser.yml'));
export const nudge = YAML.parse(read('review-first-ci-nudge.yml'));

export const REQUIRED_CONTEXTS = new Set(['Build', 'Quality Gate', 'Semgrep SAST']);
export const REPO = 'o/r';
export const pr = (overrides = {}) => ({
  'github.event_name': 'pull_request',
  'github.repository': REPO,
  'github.event.pull_request.head.repo.full_name': REPO,
  ...overrides,
});
export const stage = (value) => ({ 'needs.changes.outputs.stage': value });
