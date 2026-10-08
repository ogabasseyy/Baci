import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeLabRuntime } from './lab-route';
import { setupLabRoots as baseSetupLabRoots } from './lab-test-roots';
import PilotLabPage from './page';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, preload: vi.fn() };
});

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

async function setupLabRoots() {
  return baseSetupLabRoots({
    accepted: [
      {
        assetId: 'logo-a',
        ladder: [96, 192, 384],
        merchantId: MERCHANT,
        role: 'logo',
        slot: 'header-logo',
        url: 'https://cdn.example.com/media/logo-a.png',
      },
      {
        assetId: 'hero-s0',
        ladder: [384, 768, 1280],
        merchantId: MERCHANT,
        role: 'hero',
        slot: 'mobile-hero-slide-0',
        url: 'https://cdn.example.com/media/hero-s0.png',
      },
    ],
    // Accepted on disk but never reviewed: stays on the reported
    // not-optimized path in both arms.
    unreviewed: [
      {
        assetId: 'orphan-card',
        ladder: [96, 192, 384],
        merchantId: MERCHANT,
        role: 'product',
        slot: 'product-card',
        url: 'https://cdn.example.com/media/orphan.png',
      },
    ],
  });
}

async function renderPage(arm?: string): Promise<string> {
  const element = await PilotLabPage({
    searchParams: Promise.resolve(arm === undefined ? {} : { arm }),
  });
  return renderToStaticMarkup(element);
}

describe('pilot-lab route', () => {
  afterEach(() => {
    Reflect.deleteProperty(
      globalThis,
      Symbol.for('baci.merchant-image-pilot.runtime')
    );
    vi.unstubAllEnvs();
  });

  it('renders nothing when the lab flag is off', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    await expect(renderPage('pilot')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('mounts accepted bindings through staged pilot derivatives', async () => {
    const roots = await setupLabRoots();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
    await initializeLabRuntime();
    const html = await renderPage('pilot');
    expect(html).toContain('data-pilot-lab-picture="pilot"');
    expect(html).toContain(`/__pilot/${roots.generationIds['logo-a']}/`);
    expect(html).toContain(`/__pilot/${roots.generationIds['hero-s0']}/`);
    expect(html).toContain('data-pilot-lab-preload="pilot"');
    expect(html).toContain('384w');
    // The unreviewed binding keeps the reported path in the pilot arm too.
    expect(html).toContain('orphan-card');
    expect(html).toContain('not optimized');
  });

  it('mounts the control arm from staged original bytes only', async () => {
    const roots = await setupLabRoots();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
    await initializeLabRuntime();
    const html = await renderPage('control');
    expect(html).toContain('data-pilot-lab-picture="control"');
    expect(html).toContain('/__pilot/originals/');
    expect(html).not.toContain(`/__pilot/${roots.generationIds['logo-a']}/`);
    expect(html).not.toContain(`/__pilot/${roots.generationIds['hero-s0']}/`);
  });

  it('caveats the per-format guard and the over-source exception', async () => {
    const roots = await setupLabRoots();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
    await initializeLabRuntime();
    const html = await renderPage('pilot');
    expect(html).toContain('per-format');
    expect(html).toContain('generated-over-source');
  });

  it('defaults to the pilot arm', async () => {
    const roots = await setupLabRoots();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
    await initializeLabRuntime();
    const html = await renderPage();
    expect(html).toContain('data-pilot-lab-picture="pilot"');
  });

  it('404s unknown ?arm values instead of silently rendering pilot', async () => {
    const roots = await setupLabRoots();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
    for (const arm of ['Pilot', 'CONTROL', 'both', '', 'pilot ']) {
      await expect(renderPage(arm)).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });

  it('marks every binding so the served gate can prove coverage', async () => {
    const roots = await setupLabRoots();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
    await initializeLabRuntime();
    const html = await renderPage('pilot');
    expect(html).toContain(`data-pilot-lab-binding="${MERCHANT}/logo-a"`);
    expect(html).toContain(`data-pilot-lab-binding="${MERCHANT}/hero-s0"`);
    expect(html).toContain(`data-pilot-lab-binding="${MERCHANT}/orphan-card"`);
  });

  it('refuses startup when the frozen inputs are corrupt', async () => {
    const roots = await setupLabRoots();
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
    vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
    await initializeLabRuntime();
    const html = await renderPage('pilot');
    expect(html).toContain('data-pilot-lab-picture="pilot"');
    // Frozen runtime ignores later drift (covered in lab-route.test.ts);
    // a restart against corrupt inputs fails closed at startup instead.
    await writeFile(join(roots.outputRoot, 'acceptances.json'), '{corrupt');
    Reflect.deleteProperty(
      globalThis,
      Symbol.for('baci.merchant-image-pilot.runtime')
    );
    await expect(initializeLabRuntime()).rejects.toThrow();
  });
});
