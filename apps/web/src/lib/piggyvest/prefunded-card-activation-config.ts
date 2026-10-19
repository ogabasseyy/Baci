import 'server-only';
import { createHash } from 'node:crypto';
import { prefundedCardActivationConfigSchema } from '@/schemas/prefunded-card-activation-config';

type ActivationConfigIssue = {
  prerequisite: string;
  status: 'missing_or_invalid' | 'inconsistent' | 'expired';
};

type ActivationConfigResult =
  | {
      ok: true;
      configuration: ReturnType<
        typeof prefundedCardActivationConfigSchema.parse
      >;
    }
  | { ok: false; issues: ActivationConfigIssue[] };

const issueLabels: Record<string, string> = {
  expected: 'owner-proved physical database identity',
  origins: 'staging provider and public origins',
  background: 'background worker composition',
  publicCheckout: 'public checkout composition',
  recovery: 'background checkout recovery composition',
  savedCardPublicRuntime: 'saved-card public runtime composition',
  receiverReplayRuntime: 'receiver replay runtime composition',
  scope:
    'shared integration, merchant, treasury, business, system, and deadline scope',
  database: 'TLS database host, project, database, CA, and executor roles',
  provider: 'matching staging provider credentials and settings',
};

function issuesFromSchema(error: {
  issues: Array<{ code: string; path: PropertyKey[] }>;
}) {
  const issues = new Map<string, ActivationConfigIssue['status']>();
  for (const issue of error.issues) {
    const root = typeof issue.path[0] === 'string' ? issue.path[0] : '';
    const prerequisite =
      issueLabels[root] ?? 'strict activation configuration shape';
    const status =
      issue.code === 'custom' ? 'inconsistent' : 'missing_or_invalid';
    issues.set(prerequisite, status);
  }
  return [...issues].map(([prerequisite, status]) => ({
    prerequisite,
    status,
  }));
}

export function buildPrefundedCardActivationConfig(
  input: unknown,
  now: Date = new Date()
): ActivationConfigResult {
  const parsed = prefundedCardActivationConfigSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, issues: issuesFromSchema(parsed.error) };
  if (!Number.isFinite(now.getTime())) {
    return {
      ok: false,
      issues: [
        { prerequisite: 'valid preflight clock', status: 'missing_or_invalid' },
      ],
    };
  }
  if (now.getTime() >= Date.parse(parsed.data.expected.expiresAt)) {
    return {
      ok: false,
      issues: [
        {
          prerequisite: 'fixed staging activation deadline',
          status: 'expired',
        },
      ],
    };
  }

  const databases = [
    parsed.data.background.database.treasury,
    parsed.data.background.database.ingestion,
    parsed.data.background.database.authorizer,
    parsed.data.publicCheckout.checkout.customerDatabase,
    parsed.data.publicCheckout.checkout.verifierDatabase,
    parsed.data.recovery.authorizerDatabase,
  ];
  for (const database of databases) {
    if (database.transport !== 'tls' || !database.certificateAuthority) {
      return {
        ok: false,
        issues: [
          { prerequisite: issueLabels.database, status: 'missing_or_invalid' },
        ],
      };
    }
    const fingerprint = createHash('sha256')
      .update(database.certificateAuthority)
      .digest('hex');
    if (fingerprint !== parsed.data.expected.certificateAuthoritySha256) {
      return {
        ok: false,
        issues: [
          {
            prerequisite: 'owner-proved TLS certificate authority fingerprint',
            status: 'inconsistent',
          },
        ],
      };
    }
  }
  return { ok: true, configuration: parsed.data };
}
