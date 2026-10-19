import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';

export async function assertHostedSavingsDocker(
  endpoint: string | undefined,
  home = homedir(),
  inspect = stat
) {
  const allowed = [
    'unix:///var/run/docker.sock',
    `unix://${home}/.colima/default/docker.sock`,
  ];
  if (!endpoint || !allowed.includes(endpoint))
    throw new Error('Local Docker endpoint required');
  if (!(await inspect(endpoint.slice('unix://'.length))).isSocket())
    throw new Error('Local Docker socket required');
  return endpoint;
}
