import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it as test } from 'vitest';
import { verifyCompiledCandidate } from '@/lib/experience/compiled-candidate';
import { runHelperQualification } from '../../tools/experience-runner/helper-executor';
import { packPrivateBuild } from '../../tools/experience-runner/private-build-payload';

const it = test.skipIf(process.env.BACI_LOCAL_EXPERIENCE_QUALIFICATION !== '1');
const exec = promisify(execFile);
const ssh = (args: string[], timeout = 10000) =>
  exec('colima', ['ssh', '--', ...args], {
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });

it('qualifies a disposable non-root account with access only to its fixed helper', async () => {
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const user = `baciq${id}`;
  const helper = `/usr/local/bin/baci-qualification-${id}`;
  const sudoers = `/etc/sudoers.d/baci-qualification-${id}`;
  const source = resolve('tools/experience-runner/privileged-helper.py');
  let createdUser = false;
  let installedHelper = false;
  let installedRule = false;
  try {
    await ssh([
      'sudo',
      'install',
      '-o',
      'root',
      '-g',
      'root',
      '-m',
      '0755',
      source,
      helper,
    ]);
    installedHelper = true;
    await ssh([
      'sudo',
      'useradd',
      '--system',
      '--no-create-home',
      '--shell',
      '/usr/sbin/nologin',
      user,
    ]);
    createdUser = true;
    await ssh(['sudo', 'test', '!', '-e', sudoers]);
    installedRule = true;
    const rule = exec('colima', ['ssh', '--', 'sudo', 'tee', sudoers], {
      timeout: 10000,
    });
    rule.child.stdin?.on('error', () => undefined);
    rule.child.stdin?.end(`${user} ALL=(root) NOPASSWD: ${helper}\n`);
    await rule;
    await ssh(['sudo', 'chmod', '0440', sudoers]);
    await ssh(['sudo', 'visudo', '-cf', sudoers]);
    await expect(
      ssh(['sudo', '-u', user, 'sudo', '-n', '/usr/bin/id'])
    ).rejects.toThrow();
    await expect(
      ssh(['sudo', '-u', user, 'test', '-w', helper])
    ).rejects.toThrow();
    await expect(
      ssh(['sudo', '-u', user, 'sudo', '-n', helper, 'run', '../outside'])
    ).rejects.toThrow();
    const result = await runHelperQualification(
      'compile',
      packPrivateBuild(
        {
          format: 'baci.experience/v2',
          runtime: 'react-browser-sandbox/v1',
          sdkVersion: 'commerce-bridge/v1',
          entry: 'app.tsx',
          files: [
            {
              path: 'app.tsx',
              content:
                'export default function Store(){return <h1>Synthetic privilege boundary</h1>}',
            },
          ],
          packages: [],
          assets: [],
          routes: [{ path: '/', view: 'home' }],
          capabilities: [],
        },
        'https://shop.synthetic.test',
        'production'
      ),
      async (program, args, input, timeoutMs) => {
        expect(program).toBe('/usr/bin/sudo');
        expect(args.slice(0, 2)).toEqual([
          '-n',
          '/usr/local/libexec/baci-experience-helper',
        ]);
        const child = exec(
          'colima',
          [
            'ssh',
            '--',
            'sudo',
            '-u',
            user,
            'sudo',
            '-n',
            helper,
            ...args.slice(2),
          ],
          { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }
        );
        child.child.stdin?.on('error', () => undefined);
        child.child.stdin?.end(input);
        return (await child).stdout;
      }
    );
    expect(verifyCompiledCandidate(result.output).hostOrigin).toBe(
      'https://shop.synthetic.test'
    );
    await ssh([
      'sudo',
      'test',
      '!',
      '-e',
      `/var/tmp/baci-experience-checkpoint-a/jobs/${result.jobId}`,
    ]);
  } finally {
    try {
      if (installedRule) await ssh(['sudo', 'rm', '-f', sudoers]);
    } finally {
      try {
        if (createdUser) await ssh(['sudo', 'userdel', user]);
      } finally {
        if (installedHelper) await ssh(['sudo', 'rm', '-f', helper]);
      }
    }
  }
}, 120000);
