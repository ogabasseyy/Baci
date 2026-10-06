import { constants } from 'node:fs';
import { lstat, open, readFile, rename } from 'node:fs/promises';
import { request } from 'node:http';
import {
  account,
  config,
  environment,
  execute,
  parseState,
} from './funding-gateway-recovery-identity.mjs';

export function run(command, argumentsList) {
  return execute(command, argumentsList, {
    env: environment,
    killSignal: 'SIGKILL',
    maxBuffer: 1048576,
    timeout: 8000,
  }).then(({ stdout }) => stdout.trim());
}

export async function serviceState(name) {
  const state = parseState(
    await run('/usr/bin/systemctl', [
      'show',
      name,
      '--property=LoadState,ActiveState,MainPID,InvocationID,Restart,NRestarts,FragmentPath,DropInPaths,NeedDaemonReload',
      '--no-pager',
    ]),
    [
      'LoadState',
      'ActiveState',
      'MainPID',
      'InvocationID',
      'Restart',
      'NRestarts',
      'FragmentPath',
      'DropInPaths',
      'NeedDaemonReload',
    ],
    ['DropInPaths', 'InvocationID']
  );
  if (
    state.LoadState !== 'loaded' ||
    state.FragmentPath !== `/etc/systemd/system/${name}` ||
    state.Restart !== 'no' ||
    state.NRestarts !== '0' ||
    state.DropInPaths !== '' ||
    state.NeedDaemonReload !== 'no'
  )
    throw new Error('Systemd state rejected');
  return state;
}

export function requestStatus(options) {
  return new Promise((resolve, reject) => {
    const call = request(
      {
        ...options,
        headers: { Host: 'staging-auth.ogabassey.com' },
        method: 'GET',
      },
      (response) => {
        response.destroy();
        resolve(response.statusCode);
      }
    );
    const timer = setTimeout(
      () => call.destroy(new Error('Reachability rejected')),
      2500
    );
    call.on('close', () => clearTimeout(timer));
    call.on('error', reject);
    call.end();
  });
}

export async function gatewayAccount(read = readFile, command = run) {
  const [fields, unit] = await Promise.all([
    command('/usr/bin/getent', ['passwd', account]).then((value) =>
      value.split(':')
    ),
    read('/etc/systemd/system/baci-savings-gateway.service', 'utf8'),
  ]);
  const group = /^Group=([^\n\r]+)$/m.exec(unit)?.[1];
  const groupFields = group
    ? (await command('/usr/bin/getent', ['group', group])).split(':')
    : [];
  if (
    fields.length !== 7 ||
    !/^\d+$/.test(fields[2]) ||
    groupFields.length !== 4 ||
    !/^\d+$/.test(groupFields[2]) ||
    !/^User=baci-savings-gateway$/m.test(unit)
  )
    throw new Error('Gateway account rejected');
  return { gid: Number(groupFields[2]), uid: Number(fields[2]) };
}

export async function replaceEvidence(evidence) {
  const existing = await lstat(`${config}/startup-evidence.json`);
  if (
    !existing.isFile() ||
    existing.uid !== 0 ||
    existing.nlink !== 1 ||
    (existing.mode & 0o777) !== 0o440
  )
    throw new Error('Startup evidence rejected');
  const temporary = `${config}/.startup-evidence-${process.pid}.json`;
  const file = await open(
    temporary,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600
  );
  try {
    await file.writeFile(JSON.stringify(evidence));
    await file.chown(0, existing.gid);
    await file.chmod(0o440);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, `${config}/startup-evidence.json`);
}

export async function verifySocket(identity, accountInfo) {
  const [runtime, socket] = await Promise.all([
    lstat('/run/baci-savings-gateway'),
    lstat('/run/baci-savings-gateway/ingress.sock'),
  ]);
  if (
    !runtime.isDirectory() ||
    runtime.uid !== accountInfo.uid ||
    runtime.gid !== accountInfo.gid ||
    (runtime.mode & 0o7777) !== 0o750 ||
    !socket.isSocket() ||
    socket.uid !== accountInfo.uid ||
    socket.gid !== accountInfo.gid ||
    (socket.mode & 0o7777) !== 0o660 ||
    !identity.containers ||
    !identity.networks
  )
    throw new Error('Gateway socket rejected');
}
