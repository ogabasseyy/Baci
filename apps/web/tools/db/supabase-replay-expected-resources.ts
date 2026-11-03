import type { ReplayCommand } from './supabase-history-replay-types';

export const SUPABASE_PROJECT_LABEL = 'com.supabase.cli.project';

export type ExpectedSupabaseReplayResources = {
  containers: Array<{ image?: string; name: string }>;
  networks: string[];
  volumes: string[];
};

type ObservedResource = {
  labels: Record<string, string>;
  name: string;
};

export type ObservedSupabaseReplayResources = {
  containers: Array<ObservedResource & { image?: string }>;
  networks: ObservedResource[];
  volumes: ObservedResource[];
};

function dockerLabels(value: string): Record<string, string> {
  if (!value) return {};
  const entries = value.split(',').map((entry) => {
    const separator = entry.indexOf('=');
    if (separator <= 0) throw new Error();
    return [entry.slice(0, separator), entry.slice(separator + 1)] as const;
  });
  return Object.fromEntries(entries);
}

export async function inspectSupabaseReplayResources(
  projectId: string,
  runCommand: ReplayCommand
): Promise<ObservedSupabaseReplayResources> {
  if (!PROJECT_ID.test(projectId)) {
    throw new Error('Invalid Supabase replay project id');
  }
  const filter = `label=${SUPABASE_PROJECT_LABEL}=${projectId}`;
  const rows = async (
    args: string[],
    requiredKeys: readonly string[]
  ): Promise<Record<string, string>[]> => {
    const output = (await runCommand('docker', args)).stdout.trim();
    if (!output) return [];
    try {
      return output.split('\n').map((line) => {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error();
        }
        const row = parsed as Record<string, unknown>;
        if (requiredKeys.some((key) => typeof row[key] !== 'string')) {
          throw new Error();
        }
        dockerLabels(row.Labels as string);
        return row as Record<string, string>;
      });
    } catch {
      throw new Error('Docker replay resource output is invalid');
    }
  };
  const volumeNames = [
    `supabase_db_${projectId}`,
    `supabase_edge_runtime_${projectId}`,
  ];
  const [containers, volumes, networks, ...exactVolumeGroups] =
    await Promise.all([
      rows(
        ['ps', '-a', '--filter', filter, '--format', '{{json .}}'],
        ['Labels', 'Names', 'Image']
      ),
      rows(
        ['volume', 'ls', '--filter', filter, '--format', '{{json .}}'],
        ['Labels', 'Name']
      ),
      rows(
        ['network', 'ls', '--filter', filter, '--format', '{{json .}}'],
        ['Labels', 'Name']
      ),
      // Existing volumes can lack our label; check both exact names independently.
      ...volumeNames.map((name) =>
        rows(
          [
            'volume',
            'ls',
            '--filter',
            `name=^${name}$`,
            '--format',
            '{{json .}}',
          ],
          ['Labels', 'Name']
        )
      ),
    ]);
  for (const [index, exactVolumes] of exactVolumeGroups.entries()) {
    const expectedName = volumeNames[index];
    if (
      exactVolumes.length > 1 ||
      exactVolumes.some((row) => row.Name !== expectedName)
    ) {
      throw new Error('Docker replay resource output is invalid');
    }
    for (const exact of exactVolumes) {
      const prior = volumes.find((row) => row.Name === exact.Name);
      if (prior) {
        const first = dockerLabels(prior.Labels);
        const second = dockerLabels(exact.Labels);
        if (
          Object.keys(first).length !== Object.keys(second).length ||
          Object.keys(first).some((key) => first[key] !== second[key])
        ) {
          throw new Error('Docker replay resource output is invalid');
        }
      } else volumes.push(exact);
    }
  }
  const observed = (row: Record<string, string>, key: string) => ({
    labels: dockerLabels(row.Labels ?? ''),
    name: row[key] ?? '',
  });
  return {
    containers: containers.map((row) => ({
      ...observed(row, 'Names'),
      image: row.Image,
    })),
    networks: networks.map((row) => observed(row, 'Name')),
    volumes: volumes.map((row) => observed(row, 'Name')),
  };
}

const DATABASE_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.156';
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{2,62}$/;

export function expectedSupabaseReplayResources(
  _options: {
    imageTransformationEnabled?: boolean;
    poolerEnabled?: boolean;
  },
  projectId: string
): ExpectedSupabaseReplayResources {
  if (!PROJECT_ID.test(projectId)) {
    throw new Error('Invalid Supabase replay project id');
  }
  return {
    containers: [
      {
        image: DATABASE_IMAGE,
        name: `supabase_db_${projectId}`,
      },
    ],
    networks: [`supabase_network_${projectId}`],
    volumes: [`supabase_db_${projectId}`],
  };
}

function assertResourceList(
  observed: ObservedResource[],
  expectedNames: readonly string[],
  projectId: string,
  allowPartial: boolean,
  kind: 'container' | 'volume' | 'network',
  optionalNames: readonly string[] = []
): void {
  const names = observed.map(({ labels, name }) => {
    if (
      labels[SUPABASE_PROJECT_LABEL] !== projectId ||
      (!expectedNames.includes(name) && !optionalNames.includes(name))
    ) {
      throw new ResourceMismatch(`${kind}-unexpected`);
    }
    return name;
  });
  if (new Set(names).size !== names.length)
    throw new ResourceMismatch(`${kind}-duplicate`);
  if (!allowPartial && expectedNames.some((name) => !names.includes(name)))
    throw new ResourceMismatch(`${kind}-missing`);
}

class ResourceMismatch extends Error {}

export function assertSupabaseReplayResources(
  observed: ObservedSupabaseReplayResources,
  expected: ExpectedSupabaseReplayResources,
  options: { allowPartial: boolean; projectId: string }
): void {
  try {
    const expectedContainers = new Map(
      expected.containers.map((container) => [container.name, container])
    );
    assertResourceList(
      observed.containers,
      [...expectedContainers.keys()],
      options.projectId,
      options.allowPartial,
      'container'
    );
    for (const container of observed.containers) {
      const expectedContainer = expectedContainers.get(container.name);
      if (
        !expectedContainer ||
        (expectedContainer.image && container.image !== expectedContainer.image)
      ) {
        throw new ResourceMismatch('container-image');
      }
    }
    assertResourceList(
      observed.volumes,
      expected.volumes,
      options.projectId,
      options.allowPartial,
      'volume',
      // CLI 2.111 may create this best-effort pg-delta cache volume while
      // bootstrapping. It carries the same exact project ownership label.
      [`supabase_edge_runtime_${options.projectId}`]
    );
    assertResourceList(
      observed.networks,
      expected.networks,
      options.projectId,
      options.allowPartial,
      'network'
    );
  } catch (error) {
    throw new Error(
      `Supabase replay resource verification failed${error instanceof ResourceMismatch ? ` (${error.message})` : ''}`
    );
  }
}
