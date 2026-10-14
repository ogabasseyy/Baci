import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { surfaceProblems } from './merchant-image-pilot-readiness-checks.mjs';
import {
  controlImageUrlsOk,
  duplicateImageUrlViolation,
  pilotImageUrlsOk,
} from './merchant-image-pilot-readiness-purity.mjs';

// @ts-expect-error import.meta.dirname is provided by vitest.
const here = import.meta.dirname;
const PURITY_SOURCE = join(here, 'merchant-image-pilot-readiness-purity.mjs');
const FIXTURES_SOURCE = join(
  here,
  '../../src/lib/merchant-image-variant-pilot/lab-fixtures.ts'
);
const LAYOUT_SOURCE = join(here, '../../src/app/layout.tsx');

function blockStrings(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  const block = source.slice(from, to);
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('merchant-image-pilot-readiness network purity', () => {
  it('admits only selected tiers, fillers, and icons on pilot', () => {
    const tiers = ['/__pilot/abc/x.avif'];
    expect(pilotImageUrlsOk(['https://lab/__pilot/abc/x.avif'], tiers)).toBe(
      true
    );
    // An unmarked generation batch passes the old not-originals rule but
    // must fail the allowlist.
    expect(pilotImageUrlsOk(['https://lab/__pilot/stale/x.avif'], tiers)).toBe(
      false
    );
    expect(
      pilotImageUrlsOk(['https://lab/__pilot/originals/x.png'], tiers)
    ).toBe(false);
    // Same generation, unselected tier: a mismatched preload fetching
    // one tier while the render selects another must fail — the extra
    // bytes and contention corrupt the comparison.
    expect(
      pilotImageUrlsOk(['https://lab/__pilot/abc/other.avif'], tiers)
    ).toBe(false);
    expect(
      pilotImageUrlsOk(
        ['https://lab/__pilot/fillers/grid-filler-600x400-a.png'],
        tiers
      )
    ).toBe(true);
    expect(pilotImageUrlsOk(['https://lab/favicon.ico'], tiers)).toBe(true);
    expect(pilotImageUrlsOk(['https://cdn.example.com/x.png'], tiers)).toBe(
      false
    );
  });

  it('flags a tier fetched twice on either arm', () => {
    const tiers = ['/__pilot/abc/x.avif'];
    expect(
      pilotImageUrlsOk(
        ['https://lab/__pilot/abc/x.avif', 'https://lab/__pilot/abc/x.avif'],
        tiers
      )
    ).toBe(true);
    // Multiplicity is a separate verdict, not the allowlist's: the
    // duplicate check flags it while the URL set still passes.
    expect(
      duplicateImageUrlViolation([
        'https://lab/__pilot/abc/x.avif',
        'https://lab/__pilot/abc/x.avif',
      ])
    ).toBe('https://lab/__pilot/abc/x.avif');
    expect(duplicateImageUrlViolation(['https://lab/__pilot/abc/x.avif'])).toBe(
      undefined
    );
    // Fillers/icons are exempt: frozen sets shared across cards.
    expect(
      duplicateImageUrlViolation([
        'https://lab/__pilot/fillers/grid-filler-600x400-a.png',
        'https://lab/__pilot/fillers/grid-filler-600x400-a.png',
      ])
    ).toBe(undefined);
  });

  it('admits only staged originals, fillers, and icons on control', () => {
    const staged = ['/__pilot/originals/x.png'];
    expect(
      controlImageUrlsOk(['https://lab/__pilot/originals/x.png'], staged)
    ).toBe(true);
    expect(
      controlImageUrlsOk(
        ['https://lab/__pilot/fillers/grid-filler-600x400-b.png'],
        staged
      )
    ).toBe(true);
    expect(controlImageUrlsOk(['https://lab/favicon.ico'], staged)).toBe(true);
    // Pilot bytes on the control arm, and a foreign staged original.
    expect(controlImageUrlsOk(['https://lab/__pilot/abc/x.avif'], staged)).toBe(
      false
    );
    expect(
      controlImageUrlsOk(['https://lab/__pilot/originals/other.png'], staged)
    ).toBe(false);
  });

  it('names the offending fetch at the surface level', () => {
    const mount = {
      binding: 'merchant/card-a',
      generationId: 'abc',
      merchantId: 'merchant',
      slotId: 'product-card',
      stagedOriginal: '/__pilot/originals/card.png',
    };
    const collected = {
      consoleErrors: [],
      failedRequests: [],
      geometry: {
        devicePixelRatio: 1,
        gridDisplay: 'grid',
        heading: { height: 1, width: 1, x: 0, y: 0 },
        imgObjectFit: 'cover',
        selected: { height: 100, width: 100, x: 0, y: 0 },
        selectedImg: null,
        slots: [
          {
            binding: 'merchant/card-a',
            img: { box: { height: 0, width: 0, x: 0, y: 0 } },
            slotId: 'product-card',
            status: null,
          },
        ],
        stylesheetBytes: 10,
        stylesheetCount: 1,
        viewportHeight: 600,
        viewportWidth: 800,
      },
      imageUrls: ['https://lab/__pilot/stale/hero.avif'],
    };
    const options = {
      arm: 'pilot',
      expectHiddenMounts: true,
      expectedFit: 'cover',
      expectedMounts: [mount],
      surface: 'grid',
    };
    // Hidden primary: geometry verdicts vacate, but network purity still
    // catches the extra unmarked generation fetch.
    expect(surfaceProblems(collected, options)).toEqual([
      'pilot requested an image outside the approved tier set: /__pilot/stale/hero.avif',
    ]);
    expect(
      surfaceProblems(
        {
          ...collected,
          imageUrls: ['https://lab/__pilot/abc/card.avif'],
        },
        { ...options, arm: 'control' }
      )
    ).toEqual([
      'control requested an image outside the approved staged set: /__pilot/abc/card.avif',
    ]);
  });

  it('mirrors the frozen filler list from the fixture layer', () => {
    // The gate cannot import the app's TS fixtures, so both sides pin by
    // source text: a new filler must land in both files at once.
    const fixtures = readFileSync(FIXTURES_SOURCE, 'utf8');
    const wanted = blockStrings(
      fixtures,
      'PILOT_LAB_FILLER_IMAGES',
      '];'
    ).filter((entry) => entry.startsWith('/'));
    const checks = readFileSync(PURITY_SOURCE, 'utf8');
    const mirrored = blockStrings(
      checks,
      'PILOT_FILLER_PATHNAMES',
      ']);'
    ).filter((entry) => entry.startsWith('/'));
    expect(wanted.length).toBeGreaterThan(0);
    expect([...mirrored].sort()).toEqual([...wanted].sort());
  });

  it('mirrors the layout icon candidates plus the favicon fallback', () => {
    // Browsers pick among the layout's rel=icon candidates
    // version-dependently; the gate admits exactly those plus the
    // automatic /favicon.ico. Manifest/apple icons are not load-time
    // fetches and must stay excluded.
    const layout = readFileSync(LAYOUT_SOURCE, 'utf8');
    const iconBlockStart = layout.indexOf('icon: [');
    const iconBlock = layout.slice(
      iconBlockStart,
      layout.indexOf('],', iconBlockStart)
    );
    const layoutIcons = [...iconBlock.matchAll(/url: '([^']+)'/g)].map(
      (match) => match[1]
    );
    expect(layoutIcons.length).toBeGreaterThan(0);
    const checks = readFileSync(PURITY_SOURCE, 'utf8');
    const mirrored = blockStrings(
      checks,
      'BROWSER_ICON_PATHNAMES',
      ']);'
    ).filter((entry) => entry.startsWith('/'));
    expect([...mirrored].sort()).toEqual(
      [...layoutIcons, '/favicon.ico'].sort()
    );
  });
});
