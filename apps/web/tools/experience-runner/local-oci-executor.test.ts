import { describe, expect, it } from 'vitest';
import {
  outputBudgetExceeded,
  runLocalQualification,
} from './local-oci-executor';

describe('local qualification supervisor', () => {
  it('accounts for combined stdout/stderr UTF-8 bytes, including multibyte output', () => {
    const exceeds = outputBudgetExceeded(10);
    expect(exceeds('aaaa')).toBe(false);
    expect(exceeds(Buffer.from('bbbb'))).toBe(false);
    expect(exceeds('€')).toBe(true);
  });
  it('keeps tickets and parent provider env outside child and cleans scoped jobs', async () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const result = await runLocalQualification(
      'checks',
      { mode: 'native-seo-assets' },
      async (args, input) => {
        calls.push({ args, input });
        return args.includes('run') ? '{"forgedReady":true}' : '';
      }
    );
    const spec = JSON.parse(calls[0].input ?? '{}').spec;
    expect(spec.process.env).toEqual([
      'PATH=/usr/local/bin:/usr/bin:/bin',
      'LANG=C.UTF-8',
      'TZ=UTC',
      'HOME=/tmp',
      'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    ]);
    expect(spec.mounts.some((m: { type: string }) => m.type === 'bind')).toBe(
      false
    );
    expect(result).not.toHaveProperty('accepted');
    expect(result.output).toEqual({ forgedReady: true });
    expect(calls.at(-2)?.args).toContain('delete');
    expect(calls.at(-1)?.args).toContain('python3');
    expect(calls.at(-1)?.args.at(-1)).toMatch(/^baci-experience-/);
  });
  it('cleans up failed, infinite and oversized jobs rather than accepting their output', async () => {
    const argsSeen: string[][] = [];
    await expect(
      runLocalQualification('checks', {}, async (args) => {
        argsSeen.push(args);
        if (args.includes('run')) throw Error('deadline');
        return '';
      })
    ).rejects.toThrow('deadline');
    expect(argsSeen.at(-2)).toContain('delete');
    expect(argsSeen.at(-1)).toContain('python3');
    await expect(
      runLocalQualification(
        'checks',
        { data: 'x'.repeat(8 * 1024 * 1024) },
        async () => ''
      )
    ).rejects.toThrow('Input budget');
  });
});

it('preserves the primary execution error if sandbox cleanup also fails', async () => {
  const primary = Error('original deadline');
  await expect(
    runLocalQualification('checks', {}, async (args) => {
      if (args.includes('run')) throw primary;
      if (args.includes('delete')) throw Error('cleanup unavailable');
      return '';
    })
  ).rejects.toBe(primary);
});

it('removes only the generated job bundle after deleting its sandbox', async () => {
  const calls: string[][] = [];
  await runLocalQualification('checks', {}, async (args) => {
    calls.push(args);
    return args.includes('run') ? '{}' : '';
  });
  const deleted = calls.findIndex((args) => args.includes('delete'));
  expect(calls.length).toBe(deleted + 2);
  expect(calls.at(-1)).toContain('python3');
  expect(calls.at(-1)?.at(-1)).toBe(calls[deleted].at(-1));
});

it('rejects otherwise successful output when sandbox deletion fails and retains its bundle', async () => {
  const calls: string[][] = [];
  const cleanupError = Error('sandbox may still be running');
  await expect(
    runLocalQualification('checks', {}, async (args) => {
      calls.push(args);
      if (args.includes('delete')) throw cleanupError;
      return args.includes('run') ? '{}' : '';
    })
  ).rejects.toBe(cleanupError);
  expect(calls.at(-1)).toContain('delete');
  expect(calls.filter((args) => args.includes('python3'))).toHaveLength(1);
});

it('executes prerendering only in the credential-free Node sandbox with build limits', async () => {
  const calls: Array<{ args: string[]; input?: string; timeout?: number }> = [];
  await runLocalQualification(
    'prerender',
    { javascript: 'untrusted' },
    async (args, input, timeout) => {
      calls.push({ args, input, timeout });
      return args.includes('run') ? '{"html":"<h1>public</h1>"}' : '';
    }
  );
  const spec = JSON.parse(calls[0].input ?? '{}').spec;
  expect(spec.root.path.endsWith('/node24/rootfs')).toBe(true);
  expect(spec.root.readonly).toBe(true);
  expect(spec.process.args[1]).toBe('/opt/experience/prerender-worker.mjs');
  expect(spec.process.env).toEqual([
    'PATH=/usr/local/bin:/usr/bin:/bin',
    'LANG=C.UTF-8',
    'TZ=UTC',
  ]);
  expect(spec.linux.resources.memory.limit).toBe(2 * 1024 * 1024 * 1024);
  const execution = calls.find((c) => c.args.includes('run'));
  expect(execution?.args).toContain('--network=none');
  expect(execution?.timeout).toBe(60000);
});

it('allows a bounded 60 seconds for offline browser evidence capture', async () => {
  const calls: Array<{ args: string[]; timeout?: number }> = [];
  await runLocalQualification('capture', {}, async (args, _input, timeout) => {
    calls.push({ args, timeout });
    return args.includes('run') ? '{}' : '';
  });
  const execution = calls.find((call) => call.args.includes('run'));
  expect(execution?.args).toContain('--network=none');
  expect(execution?.timeout).toBe(60000);
});

it('keeps prerender browser verification in the network-disabled capture profile', async () => {
  const calls: Array<{ args: string[]; input?: string; timeout?: number }> = [];
  await runLocalQualification(
    'prerender-checks',
    {},
    async (args, input, timeout) => {
      calls.push({ args, input, timeout });
      return args.includes('run') ? '{}' : '';
    }
  );
  const spec = JSON.parse(calls[0].input ?? '{}').spec;
  expect(spec.process.args[1]).toBe(
    '/opt/experience/prerender-browser-worker.mjs'
  );
  expect(spec.root.path.endsWith('/browser/rootfs')).toBe(true);
  expect(spec.linux.resources.memory.limit).toBe(3 * 1024 * 1024 * 1024);
  expect(calls.find((c) => c.args.includes('run'))?.timeout).toBe(30000);
});

it('compiles prerender companion artifacts in a separate credential-free offline Node job', async () => {
  const calls: Array<{ args: string[]; input?: string; timeout?: number }> = [];
  await runLocalQualification(
    'prerender-build',
    {},
    async (args, input, timeout) => {
      calls.push({ args, input, timeout });
      return args.includes('run') ? '{}' : '';
    }
  );
  const spec = JSON.parse(calls[0].input ?? '{}').spec;
  expect(spec.process.args[1]).toBe(
    '/opt/experience/prerender-build-worker.mjs'
  );
  expect(spec.root.path.endsWith('/node24/rootfs')).toBe(true);
  expect(calls.find((c) => c.args.includes('run'))?.timeout).toBe(60000);
  expect(calls.find((c) => c.args.includes('run'))?.args).toContain(
    '--network=none'
  );
});

it('keeps durable public browser proofs in the existing offline capture profile', async () => {
  const calls: Array<{ args: string[]; input?: string; timeout?: number }> = [];
  await runLocalQualification(
    'durable-public-checks',
    {},
    async (args, input, timeout) => {
      calls.push({ args, input, timeout });
      return args.includes('run') ? '{}' : '';
    }
  );
  const spec = JSON.parse(calls[0].input ?? '{}').spec;
  expect(spec.process.args[1]).toBe(
    '/opt/experience/public-browser-worker.mjs'
  );
  expect(spec.root.path.endsWith('/browser/rootfs')).toBe(true);
  expect(spec.linux.resources.memory.limit).toBe(3 * 1024 * 1024 * 1024);
  expect(calls.find((c) => c.args.includes('run'))?.timeout).toBe(30000);
  expect(calls.find((c) => c.args.includes('run'))?.args).toContain(
    '--network=none'
  );
});
