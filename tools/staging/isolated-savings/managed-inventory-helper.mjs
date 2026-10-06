#!/usr/bin/node
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readManagedFile } from './managed-files.mjs';
import {
  generateManagedGateway,
  validateManagedBinding,
} from './managed-gateway.mjs';
import { collectSupervisorInventory } from './private-routing-supervisor-inventory.mjs';

export async function managedInventory(binding, run, now) {
  validateManagedBinding(binding, now());
  const inventory = await collectSupervisorInventory(
    binding.identity,
    run,
    now
  );
  for (const container of inventory.containers) {
    const labels = container.Config.Labels;
    container.Config.Labels = {
      'com.docker.compose.project': labels?.['com.docker.compose.project'],
      'com.docker.compose.service': labels?.['com.docker.compose.service'],
    };
  }
  for (const network of inventory.networks) {
    const labels = network.Labels;
    network.Labels = {
      'com.docker.compose.project': labels?.['com.docker.compose.project'],
      'com.docker.compose.network': labels?.['com.docker.compose.network'],
    };
  }
  generateManagedGateway(binding, inventory, now());
  return inventory;
}

async function main() {
  if (
    process.platform !== 'linux' ||
    process.geteuid() !== 0 ||
    process.argv.length !== 2
  )
    throw new Error('Fixed inventory helper only');
  const { value: binding } = await readManagedFile(
    '/etc/baci-savings-gateway/binding.json'
  );
  const execute = promisify(execFile);
  const run = async (args) =>
    (
      await execute('/usr/bin/docker', args, {
        env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' },
        timeout: 1500,
        killSignal: 'SIGKILL',
        maxBuffer: 262144,
      })
    ).stdout;
  process.stdout.write(
    JSON.stringify(await managedInventory(binding, run, Date.now))
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write('Managed inventory refused.\n');
    process.exitCode = 1;
  });
