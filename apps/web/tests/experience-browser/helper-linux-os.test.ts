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

it('runs and cleans up a synthetic compile through the fixed helper on the disposable gVisor VM', async () => {
  const id = randomUUID();
  const target = `/var/tmp/baci-experience-checkpoint-a/qualification-helper-${id}.py`;
  const source = resolve('tools/experience-runner/privileged-helper.py');
  await exec('colima', ['ssh', '--', 'sudo', 'cp', source, target], {
    timeout: 10000,
  });
  try {
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
                'export default function Store(){return <h1>Synthetic helper test</h1>}',
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
          ['ssh', '--', 'sudo', 'python3', '-I', target, ...args.slice(2)],
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
    await expect(
      exec(
        'colima',
        [
          'ssh',
          '--',
          'sudo',
          'test',
          '!',
          '-e',
          `/var/tmp/baci-experience-checkpoint-a/jobs/${result.jobId}`,
        ],
        { timeout: 10000 }
      )
    ).resolves.toBeDefined();
  } finally {
    await exec('colima', ['ssh', '--', 'sudo', 'rm', '-f', target], {
      timeout: 10000,
    });
  }
}, 120000);
