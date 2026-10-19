import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  seedCommittedFillers,
  setupLabRoots,
} from './app/pilot-lab/lab-test-roots';
import { register } from './instrumentation';

// Unanchored-boot tests against the REAL public-assets resolver (the
// mocked suite cannot exercise the anchor throw path): with the lab
// off, a boot whose public tree cannot be anchored checks every
// candidate tree it can find, warns on DETECTED staged content
// WITHOUT quarantine (a foreign tree may belong to a live lab
// session), and only a found-nothing boot under pilot intent refuses
// — never a brick on unconfigured workers.
const registerOTelMock = vi.hoisted(() => vi.fn());
const captureServerEventMock = vi.hoisted(() => vi.fn());
const setRateLimitDiagnosticHookMock = vi.hoisted(() => vi.fn());

vi.mock('@vercel/otel', () => ({
  registerOTel: registerOTelMock,
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: captureServerEventMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  setRateLimitDiagnosticHook: setRateLimitDiagnosticHookMock,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function stubUnanchoredBoot() {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
  vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
  vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
}

function withStagedTree(publicDir: string) {
  const originals = join(publicDir, '__pilot', 'originals');
  mkdirSync(originals, { recursive: true });
  writeFileSync(join(originals, 'm1-a1.png'), 'merchant bytes');
}

describe('instrumentation unanchored boot', () => {
  it('warns and completes for a serverless-style boot with no pilot env', async () => {
    // Bare sandbox cwd (no public/, no next.config), a vitest worker
    // argv with no adjacent public/, and zero pilot configuration:
    // serverless/Vercel functions and unrelated workers structurally
    // cannot anchor, so the lab-off boot warns loudly and completes
    // instead of bricking before OTel setup.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-bare-'));
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      stubUnanchoredBoot();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(register()).resolves.toBe(undefined);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(
          /no pilot configuration detected/
        );
      } finally {
        warnSpy.mockRestore();
      }
      expect(registerOTelMock).toHaveBeenCalledOnce();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('refuses a nothing-checkable boot when pilot intent is configured', async () => {
    // Same bare sandbox, but the operator configured pilot env: an
    // unanchorable boot with pilot intent is a loud misconfiguration
    // (a custom server rooted elsewhere would serve its real tree
    // unverified), so boot refuses and names the anchor fix.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-bare-'));
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      stubUnanchoredBoot();
      vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', '/operator/input');
      await expect(register()).rejects.toThrow(/refusing an unchecked boot/);
      expect(registerOTelMock).not.toHaveBeenCalled();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('warns and completes with lab off, no checkable tree, and the ack', async () => {
    // Same bare sandbox, but the operator explicitly acknowledged the
    // unchecked residual: boot warns loudly and completes instead of
    // bricking on the anchor failure itself — even with unrelated
    // junk (outside any public/ tree) sitting in the cwd.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-bare-'));
    mkdirSync(join(sandbox, 'data'), { recursive: true });
    writeFileSync(join(sandbox, 'data', 'evil.png'), 'not a public tree');
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      stubUnanchoredBoot();
      vi.stubEnv('BACI_IMAGE_PILOT_UNANCHORED_ACK', '1');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(register()).resolves.toBe(undefined);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/found no checkable app tree/);
      } finally {
        warnSpy.mockRestore();
      }
      expect(registerOTelMock).toHaveBeenCalledOnce();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('warns and completes with lab off and a clean app-root cwd', async () => {
    // Sandbox cwd WITH a public/ dir: plausibly the served app root,
    // so the candidate check runs (finding nothing to refuse) and boot
    // completes with the loud anchor warning.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-'));
    mkdirSync(join(sandbox, 'public'), { recursive: true });
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      stubUnanchoredBoot();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(register()).resolves.toBe(undefined);
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toMatch(/checked 1 candidate tree/);
      } finally {
        warnSpy.mockRestore();
      }
      expect(registerOTelMock).toHaveBeenCalledOnce();
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('warns on staged content in the cwd candidate with lab off', async () => {
    // Foreign-tree severity: a dirty candidate warns-and-continues
    // WITHOUT quarantine — a migration or worker running near a
    // staged tree must not brick, nor mutate a tree that may belong
    // to a live lab session.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-staged-'));
    withStagedTree(join(sandbox, 'public'));
    const previousCwd = process.cwd();
    process.chdir(sandbox);
    try {
      stubUnanchoredBoot();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(register()).resolves.toBe(undefined);
        const text = warnSpy.mock.calls
          .map((call) => String(call[0]))
          .join('\n');
        expect(text).toMatch(/staged merchant pilot assets/);
        expect(text).toMatch(/without quarantine \(foreign tree\)/);
      } finally {
        warnSpy.mockRestore();
      }
      expect(registerOTelMock).toHaveBeenCalledOnce();
      expect(
        existsSync(join(sandbox, 'public', '__pilot', 'originals', 'm1-a1.png'))
      ).toBe(true);
    } finally {
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
    }
  });

  it('warns on staged content beside the server entry script', async () => {
    // Bare cwd, but argv[1] sits next to a staged app tree (the custom
    // `node /app/server.js` shape): the server-adjacent candidate is
    // checked, warns without quarantine, and boot completes.
    const sandbox = mkdtempSync(join(tmpdir(), 'pilot-unanchored-bare-'));
    const appRoot = mkdtempSync(join(tmpdir(), 'pilot-unanchored-app-'));
    withStagedTree(join(appRoot, 'public'));
    const previousCwd = process.cwd();
    const previousArgv1 = process.argv[1];
    process.chdir(sandbox);
    process.argv[1] = join(appRoot, 'server.js');
    try {
      stubUnanchoredBoot();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(register()).resolves.toBe(undefined);
        expect(
          warnSpy.mock.calls.map((call) => String(call[0])).join('\n')
        ).toMatch(/without quarantine \(foreign tree\)/);
      } finally {
        warnSpy.mockRestore();
      }
      expect(registerOTelMock).toHaveBeenCalledOnce();
      expect(
        existsSync(join(appRoot, 'public', '__pilot', 'originals', 'm1-a1.png'))
      ).toBe(true);
    } finally {
      process.argv[1] = previousArgv1;
      process.chdir(previousCwd);
      rmSync(sandbox, { force: true, recursive: true });
      rmSync(appRoot, { force: true, recursive: true });
    }
  });

  it('refuses an unanchored boot with lab on', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', '');
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
    await expect(register()).rejects.toThrow(/cannot anchor/);
    expect(registerOTelMock).not.toHaveBeenCalled();
  });
});

describe('instrumentation lab-on boot gate (real runtime)', () => {
  it('refuses a fourth filler file planted before boot', async () => {
    // End-to-end boot wiring: the boot shape gate's exact-set filler
    // check fires first here, and the boot binding check binds the
    // pinned filler paths exactly like the request path as the second
    // layer — either way a file planted under fillers/ refuses boot
    // instead of staying statically servable until the first lab
    // render.
    const lab = await setupLabRoots({
      accepted: [
        {
          assetId: 'logo-a',
          ladder: [96, 192, 384],
          merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
          role: 'logo',
          slot: 'header-logo',
          url: 'https://cdn.example.com/media/logo-a.png',
        },
      ],
    });
    await seedCommittedFillers(lab.publicDir);
    await writeFile(
      join(lab.publicDir, '__pilot', 'fillers', 'planted.png'),
      'evil'
    );
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', lab.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', lab.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', lab.publicDir);
    vi.stubEnv('BACI_PILOT_PUBLIC_DIR', lab.publicDir);
    vi.stubEnv('__NEXT_PRIVATE_STANDALONE_CONFIG', '');
    await expect(register()).rejects.toThrow(/unapproved filler/);
    expect(registerOTelMock).not.toHaveBeenCalled();
  });
});
