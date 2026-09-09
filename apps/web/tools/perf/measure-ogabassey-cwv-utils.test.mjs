import { describe, expect, it } from 'vitest';
import { ogabasseyCwvUtils } from './measure-ogabassey-cwv-utils.mjs';

const {
  applyPdpCanonicalResolution,
  buildDebugBearHeaders,
  buildLegacyPdpLcpJson,
  buildOgaBasseyCwvTargets,
  filterOgaBasseyCwvTargets,
  findDebugBearProjectIdForUrl,
  normalizeDebugBearProjects,
} = ogabasseyCwvUtils;

describe('buildDebugBearHeaders', () => {
  it('sends a stable user agent with DebugBear API requests', () => {
    expect(buildDebugBearHeaders('key')).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'Baci-CWV-debugbear-api/1.0',
      'x-api-key': 'key',
    });
  });
});

describe('applyPdpCanonicalResolution', () => {
  it('keeps the PDP target after canonical validation fails', () => {
    const pdpTarget = { label: 'pdp', url: 'https://ogabassey.com/pdp' };
    const homeTarget = { label: 'home', url: 'https://ogabassey.com/' };
    const failures = [];

    const targets = applyPdpCanonicalResolution({
      pdpResolution: {
        failure: {
          label: 'pdp',
          message: 'canonical lookup failed',
          source: 'target-resolution',
        },
        url: pdpTarget.url,
      },
      pdpTarget,
      targetResolutionFailures: failures,
      targets: [homeTarget, pdpTarget],
    });

    expect(targets).toEqual([homeTarget, pdpTarget]);
    expect(failures).toEqual([
      {
        label: 'pdp',
        message: 'canonical lookup failed',
        source: 'target-resolution',
      },
    ]);
  });
});

describe('normalizeDebugBearProjects', () => {
  it('supports DebugBear project arrays and object wrappers', () => {
    const project = { id: '101919', pages: [] };

    expect(normalizeDebugBearProjects([project])).toEqual([project]);
    expect(normalizeDebugBearProjects({ projects: [project] })).toEqual([
      project,
    ]);
    expect(normalizeDebugBearProjects({ items: [project] })).toEqual([project]);
  });
});

describe('findDebugBearProjectIdForUrl', () => {
  const projects = [
    {
      id: '101919',
      pages: [
        { url: 'https://ogabassey.com/', device: { formFactor: 'mobile' } },
        { url: 'https://ogabassey.com/blog', device: { formFactor: 'mobile' } },
      ],
    },
    {
      id: '102065',
      pages: [
        {
          url: 'https://ogabassey.com/gaming-laptops/dell-alienware-m18-r3-rtx-5080',
          device: { formFactor: 'mobile' },
        },
      ],
    },
  ];

  it('prefers an exact mobile page project match', () => {
    expect(
      findDebugBearProjectIdForUrl(
        projects,
        'https://ogabassey.com/gaming-laptops/dell-alienware-m18-r3-rtx-5080'
      )
    ).toBe('102065');
  });

  it('falls back to the same host project when no exact page exists', () => {
    expect(
      findDebugBearProjectIdForUrl(
        projects,
        'https://ogabassey.com/blog/some-new-article'
      )
    ).toBe('101919');
  });

  it('honors configured desktop device during project discovery', () => {
    expect(
      findDebugBearProjectIdForUrl(
        [
          {
            id: 'mobile-project',
            pages: [
              { url: 'https://ogabassey.com/', device: { name: 'Mobile' } },
            ],
          },
          {
            id: 'desktop-project',
            pages: [
              { url: 'https://ogabassey.com/', device: { name: 'Desktop' } },
            ],
          },
        ],
        'https://ogabassey.com/',
        { deviceName: 'Desktop' }
      )
    ).toBe('desktop-project');
  });

  it('rejects malformed target URLs instead of matching empty origins', () => {
    expect(
      findDebugBearProjectIdForUrl(
        [
          {
            id: 'bad',
            pages: [{ url: null, device: { formFactor: 'mobile' } }],
          },
        ],
        'https://['
      )
    ).toBeNull();
  });

  it('continues scanning when a matched page has no project id', () => {
    expect(
      findDebugBearProjectIdForUrl(
        [
          {
            pages: [
              { url: 'https://ogabassey.com/', device: { name: 'Mobile' } },
            ],
          },
          {
            id: 'valid-project',
            pages: [
              { url: 'https://ogabassey.com/', device: { name: 'Mobile' } },
            ],
          },
        ],
        'https://ogabassey.com/'
      )
    ).toBe('valid-project');
  });
});

describe('buildOgaBasseyCwvTargets', () => {
  it('includes home, PDP, blog index, and blog post targets', () => {
    expect(
      buildOgaBasseyCwvTargets({
        blogPostUrl: 'https://ogabassey.com/blog/post',
      })
    ).toEqual([
      { label: 'home', url: 'https://ogabassey.com/' },
      {
        label: 'pdp',
        url: 'https://ogabassey.com/gaming-laptops/dell-alienware-m18-r3-rtx-5080',
      },
      { label: 'blog-index', url: 'https://ogabassey.com/blog' },
      { label: 'blog-post-latest', url: 'https://ogabassey.com/blog/post' },
    ]);
  });

  it('falls back when target URL overrides are blank', () => {
    expect(
      buildOgaBasseyCwvTargets({
        blogUrl: ' ',
        homeUrl: '',
        pdpUrl: '	',
      })
    ).toEqual([
      { label: 'home', url: 'https://ogabassey.com/' },
      {
        label: 'pdp',
        url: 'https://ogabassey.com/gaming-laptops/dell-alienware-m18-r3-rtx-5080',
      },
      { label: 'blog-index', url: 'https://ogabassey.com/blog' },
    ]);
  });
});

describe('filterOgaBasseyCwvTargets', () => {
  const targets = buildOgaBasseyCwvTargets({
    blogPostUrl: 'https://ogabassey.com/blog/post',
  });

  it('returns every target when no filter is configured', () => {
    expect(filterOgaBasseyCwvTargets(targets, '')).toEqual(targets);
  });

  it('keeps the documented PDP LCP alias focused on the PDP target', () => {
    expect(filterOgaBasseyCwvTargets(targets, 'pdp-lcp')).toEqual([
      {
        label: 'pdp',
        url: 'https://ogabassey.com/gaming-laptops/dell-alienware-m18-r3-rtx-5080',
      },
    ]);
  });

  it('supports the latest-blog-post target alias', () => {
    expect(filterOgaBasseyCwvTargets(targets, 'latest-blog-post')).toEqual([
      { label: 'blog-post-latest', url: 'https://ogabassey.com/blog/post' },
    ]);
  });
});

describe('buildLegacyPdpLcpJson', () => {
  it('preserves legacy PDP LCP identifiers for downstream automation', () => {
    expect(
      buildLegacyPdpLcpJson({
        cls: 0.01,
        device: 'Mobile',
        fcpMs: 1200,
        lcpMs: 2400,
        quickTestId: 'qt-1',
        region: 'us-east',
        resultUrl:
          'https://www.debugbear.com/project/p/quickTest/qt-1/overview',
        tbtMs: 50,
        url: 'https://ogabassey.com/pdp',
      })
    ).toEqual({
      cls: 0.01,
      device: 'Mobile',
      fcpMs: 1200,
      lcpMs: 2400,
      quickTestId: 'qt-1',
      region: 'us-east',
      resultUrl: 'https://www.debugbear.com/project/p/quickTest/qt-1/overview',
      tbtMs: 50,
      url: 'https://ogabassey.com/pdp',
    });
  });
});
