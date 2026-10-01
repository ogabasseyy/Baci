const VERCEL_API_ORIGIN = 'https://api.vercel.com';
const TOKEN_HASH_KEY = 'BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256';
const MAX_CONTROL_PLANE_LIST_PAGES = 2;

export function builderAiBootstrapComment(runId: string): string {
  return `baci-builder-ai-bootstrap:${runId}`;
}

export interface BuilderAiVercelBootstrapClient {
  claimToken: (runId: string) => Promise<boolean>;
  disableBootstrap: () => Promise<boolean>;
  upsertAttestation: (
    values: BuilderAiAttestationEnvironment
  ) => Promise<boolean>;
}

export interface BuilderAiAttestationEnvironment {
  BUILDER_AI_PROVIDER_BINDING_PEPPER: string;
  GOOGLE_BUILDER_ACCOUNT_REF: string;
  GOOGLE_BUILDER_APPROVED_MODEL: string;
  GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG: string;
  GOOGLE_BUILDER_DEPLOYMENT_TIER: string;
  GOOGLE_BUILDER_RELEASE_ATTESTED_AT: string;
  GROQ_BUILDER_ACCOUNT_REF: string;
  GROQ_BUILDER_APPROVED_MODEL: string;
  GROQ_BUILDER_CREDENTIAL_BINDING_TAG: string;
  GROQ_BUILDER_DEPLOYMENT_TIER: string;
  GROQ_BUILDER_RELEASE_ATTESTED_AT: string;
}

interface BootstrapConfig {
  projectId: string;
  teamId: string;
  token: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

interface EnvironmentPage {
  envs: unknown[];
  next: string | null;
}

function config(environment: Environment): BootstrapConfig | null {
  const projectId = environment.VERCEL_PROJECT_ID?.trim();
  const teamId =
    environment.VERCEL_TEAM_ID?.trim() || environment.VERCEL_ORG_ID?.trim();
  const token = environment.VERCEL_API_TOKEN?.trim();
  return projectId && teamId && token ? { projectId, teamId, token } : null;
}

function url(path: string, client: BootstrapConfig): string {
  const target = new URL(`${VERCEL_API_ORIGIN}${path}`);
  target.searchParams.set('teamId', client.teamId);
  return target.toString();
}

function request(client: BootstrapConfig, init: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      Authorization: `Bearer ${client.token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  };
}

function isSuccess(response: Response): boolean {
  return response.status >= 200 && response.status < 300;
}

function environmentPage(payload: unknown): EnvironmentPage | null {
  if (!payload || typeof payload !== 'object') return null;
  const { envs, pagination } = payload as {
    envs?: unknown;
    pagination?: { next?: unknown };
  };
  if (!Array.isArray(envs)) return null;
  if (
    !pagination ||
    pagination.next === null ||
    pagination.next === undefined
  ) {
    return { envs, next: null };
  }
  if (
    typeof pagination.next !== 'string' &&
    typeof pagination.next !== 'number'
  ) {
    return null;
  }
  return { envs, next: String(pagination.next) };
}

function targetsProduction(target: unknown): boolean {
  return (
    target === 'production' ||
    (Array.isArray(target) && target.length === 1 && target[0] === 'production')
  );
}

function entries(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => ({
    key,
    target: ['production'],
    type: 'sensitive',
    value,
  }));
}

/** Fixed-scope Vercel bootstrap client. It never exposes control-plane bodies. */
export function createBuilderAiVercelBootstrapClient(
  environment: Environment = process.env,
  fetcher: typeof fetch = fetch
): BuilderAiVercelBootstrapClient | null {
  const client = config(environment);
  if (!client) return null;
  const upsert = async (values: Record<string, string>) => {
    try {
      const responses = await Promise.all(
        entries(values).map((entry) =>
          fetcher(
            url(`/v10/projects/${client.projectId}/env?upsert=true`, client),
            request(client, { body: JSON.stringify(entry), method: 'POST' })
          )
        )
      );
      return responses.every(isSuccess);
    } catch {
      return false;
    }
  };

  return {
    async claimToken(runId) {
      try {
        const rows: unknown[] = [];
        const seenCursors = new Set<string>();
        let cursor: string | null = null;
        let listedPages = 0;

        do {
          if (listedPages >= MAX_CONTROL_PLANE_LIST_PAGES) return false;
          listedPages += 1;
          const cursorQuery = cursor
            ? `?until=${encodeURIComponent(cursor)}`
            : '';
          const listed = await fetcher(
            url(`/v10/projects/${client.projectId}/env${cursorQuery}`, client),
            request(client, { method: 'GET' })
          );
          if (!isSuccess(listed)) return false;
          const page = environmentPage(await listed.json());
          if (!page) return false;
          rows.push(...page.envs);
          cursor = page.next;
          if (cursor && seenCursors.has(cursor)) return false;
          if (cursor) seenCursors.add(cursor);
        } while (cursor);

        const matches = rows.filter(
          (
            row
          ): row is {
            comment: string;
            id: string;
            key: string;
            target: unknown;
          } =>
            Boolean(
              row &&
                typeof row === 'object' &&
                typeof (row as { id?: unknown }).id === 'string' &&
                (row as { key?: unknown }).key === TOKEN_HASH_KEY &&
                (row as { comment?: unknown }).comment ===
                  builderAiBootstrapComment(runId) &&
                targetsProduction((row as { target?: unknown }).target)
            )
        );
        if (matches.length !== 1) return false;
        const deleted = await fetcher(
          url(`/v9/projects/${client.projectId}/env/${matches[0].id}`, client),
          request(client, { method: 'DELETE' })
        );
        return isSuccess(deleted);
      } catch {
        return false;
      }
    },
    disableBootstrap: () =>
      upsert({
        BUILDER_AI_ATTEST_SMOKE_ENABLED: '0',
        BUILDER_AI_ATTEST_SMOKE_EXPIRES_AT: '1970-01-01T00:00:00.000Z',
        BUILDER_AI_ATTEST_SMOKE_PHASE: 'disabled',
        BUILDER_AI_ATTEST_SMOKE_TOKEN_SHA256: '',
      }),
    upsertAttestation: (values) => upsert({ ...values }),
  };
}
