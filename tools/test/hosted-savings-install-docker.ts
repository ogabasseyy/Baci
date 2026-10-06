import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { z } from 'zod';
import type { hostedSavingsInstallContract } from './hosted-savings-install-contract';
import { hostedSavingsInstallDiagnostic } from './hosted-savings-install-diagnostic';

type Receipt = z.infer<typeof hostedSavingsInstallContract>;
const format =
  '{"id":{{json .Id}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"privileged":{{json .HostConfig.Privileged}},"caps":{{json .HostConfig.CapAdd}},"ports":{{json .HostConfig.PortBindings}},"running":{{json .State.Running}},"paused":{{json .State.Paused}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}';

export function createHostedSavingsDocker(
  receipt: Receipt,
  transport?: (args: string[], input?: string) => Promise<string>
) {
  const localDocker = async (args: string[], input?: string) => {
    if (!(await stat(receipt.dockerSocket)).isSocket())
      throw new Error('Local Docker socket missing');
    try {
      const child = execFile(
        'docker',
        ['--host', `unix://${receipt.dockerSocket}`, ...args],
        {
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
          timeout: 300000,
          maxBuffer: 1024 * 1024,
        }
      );
      const result = new Promise<string>((resolve, reject) => {
        let output = '';
        let errorOutput = '';
        child.stdout?.on('data', (data) => {
          output += String(data);
        });
        child.stderr?.on('data', (data) => {
          errorOutput += String(data);
        });
        child.on('error', () => reject(new Error('Docker command failed')));
        child.on('close', (code, signal) => {
          if (code === 0) resolve(output.trim());
          else {
            const diagnostic = hostedSavingsInstallDiagnostic(errorOutput);
            reject(
              new Error(
                `Installer command failed${diagnostic.sqlstate ? ` SQLSTATE=${diagnostic.sqlstate}` : ''}${diagnostic.line ? ` LINE=${diagnostic.line}` : ''}${code !== null ? ` EXIT=${code}` : ''}${signal ? ` SIGNAL=${signal}` : ''}; output redacted`
              )
            );
          }
        });
      });
      child.stdin?.on('error', () => child.kill());
      child.stdin?.end(input ?? '');
      return await result;
    } catch (error) {
      const diagnostic = hostedSavingsInstallDiagnostic(
        error instanceof Error ? error.message : ''
      );
      throw new Error(
        `Installer command failed${diagnostic.sqlstate ? ` SQLSTATE=${diagnostic.sqlstate}` : ''}${diagnostic.line ? ` LINE=${diagnostic.line}` : ''}${diagnostic.exitCode !== undefined ? ` EXIT=${diagnostic.exitCode}` : ''}${diagnostic.signal ? ` SIGNAL=${diagnostic.signal}` : ''}; output redacted`
      );
    }
  };
  const docker = transport ?? localDocker;
  const verify = async () => {
    const observed = JSON.parse(
      await docker(['inspect', receipt.containerId, '--format', format])
    );
    if (
      observed.id !== receipt.containerId ||
      observed.image !== receipt.imageId ||
      observed.labels?.['com.docker.compose.project'] !== receipt.project ||
      observed.labels?.['com.docker.compose.service'] !== receipt.service ||
      !observed.running ||
      observed.paused ||
      observed.privileged ||
      observed.caps?.length ||
      Object.keys(observed.ports ?? {}).length ||
      observed.mounts?.some((mount: { Destination: string }) =>
        /docker\.sock|containerd\.sock/.test(mount.Destination)
      )
    )
      throw new Error('Owned private container boundary failed');
    const networks = Object.keys(observed.networks ?? {});
    if (!networks.length)
      throw new Error('Expected isolated private network missing');
    for (const network of networks) {
      const details = JSON.parse(
        await docker([
          'network',
          'inspect',
          network,
          '--format',
          '{"internal":{{json .Internal}},"labels":{{json .Labels}},"containers":{{json .Containers}}}',
        ])
      );
      if (
        !details.internal ||
        details.labels?.['com.docker.compose.project'] !== receipt.project
      )
        throw new Error('Network is not owned and internal');
      for (const peer of Object.keys(details.containers ?? {})) {
        if (peer === receipt.containerId) continue;
        const state = JSON.parse(
          await docker([
            'inspect',
            peer,
            '--format',
            '{"running":{{json .State.Running}},"paused":{{json .State.Paused}}',
          ])
        );
        if (state.running && !state.paused)
          throw new Error('Application peer must be stopped or paused');
      }
    }
  };
  const sql = (body: string) =>
    docker(
      [
        'exec',
        '-i',
        receipt.containerId,
        'env',
        '-i',
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        'PGCONNECT_TIMEOUT=5',
        'PGOPTIONS=-c statement_timeout=240000 -c lock_timeout=5000',
        'psql',
        '-X',
        '-w',
        '-qAt',
        '-h',
        receipt.postgresSocket,
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'VERBOSITY=sqlstate',
        '-f',
        '-',
      ],
      body
    );
  return { verify, sql };
}
