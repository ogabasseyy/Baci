import assert from 'node:assert/strict';
import test from 'node:test';
import { previewWorkflowContract } from './preview-workflow-contract.helpers.mjs';

const { jobBlock, previewEnvAllowlist, previewEnvRedact } =
  previewWorkflowContract;

const DENIED_KEYS = [
  'ADDRESS_AUTOCOMPLETE_KV_REST_API_READ_ONLY_TOKEN',
  'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN',
  'ADDRESS_AUTOCOMPLETE_KV_URL',
  'ADDRESS_AUTOCOMPLETE_REDIS_URL',
  'AUTONOMA_SECRET_ID',
  'BLOG_PREVIEW_SECRET',
  'CRON_SECRET',
  'EDGE_CONFIG',
  'GEMINI_API_KEY',
  'GO54_API_KEY',
  'GOOGLE_GENAI_API_KEY',
  'IMPORT_JOB_WORKER_SECRET',
  'INTERNAL_API_SECRET',
  'KV_REST_API_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_OIDC_TOKEN',
  'ZEPTOMAIL_MAILAGENT_KEY',
  'ZEPTOMAIL_TOKEN',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
];

// Cache-mode ownership keys are deleted (not blanked) so the build job's
// explicit TURBO_CACHE owns the mode with no precedence gamble and no
// reliance on empty-string-means-unset handling.
const DENIED_ABSENT_KEYS = ['TURBO_CACHE', 'TURBO_REMOTE_ONLY'];

test('preview redacts privileged values before the exposure check', () => {
  const prepare = jobBlock('prepare');
  assert.match(
    prepare,
    /sed -i -E -f \.github\/scripts\/preview-env-redact\.sed \.vercel\/\.env\.preview\.local/
  );
  assert.ok(
    prepare.indexOf('preview-env-redact.sed') <
      prepare.indexOf('assert-preview-env-allowlist'),
    'redaction must precede the exposure check'
  );
  assert.match(
    previewEnvRedact,
    /s\/\^export\[\[:blank:\]\]/,
    'redact patterns must accept the export-prefixed form the gate allows'
  );
  for (const key of DENIED_KEYS) {
    assert.match(
      previewEnvRedact,
      new RegExp(`s/\\^${key}=\\.\\*/${key}=""\\/`),
      `${key} must stay redacted`
    );
    assert.doesNotMatch(
      previewEnvAllowlist,
      new RegExp(`^${key}$`, 'm'),
      `${key} must not be allowlisted`
    );
  }
  for (const key of DENIED_ABSENT_KEYS) {
    assert.match(
      previewEnvRedact,
      new RegExp(
        `/\\^\\[\\[:blank:\\]\\]\\*\\(export\\[\\[:blank:\\]\\]\\+\\)\\?${key}=\\.\\*/d`
      ),
      `${key} must be deleted (export-prefix-tolerant) so the job owns it`
    );
    assert.doesNotMatch(
      previewEnvAllowlist,
      new RegExp(`^${key}$`, 'm'),
      `${key} must not be allowlisted`
    );
  }
});
