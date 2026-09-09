import { describe, expect, it } from 'vitest';
import { ogabasseyCwvRunners } from './measure-ogabassey-cwv-runners.mjs';

const { createDebugBearRunner, createPsiRunner } = ogabasseyCwvRunners;

describe('createPsiRunner', () => {
  it('requests PageSpeed Insights with the selected strategy and target URL', async () => {
    const requests = [];
    const runPsi = createPsiRunner({
      apiKey: 'psi-key',
      fetchJsonImpl: (url) => {
        requests.push(url.toString());
        return {
          id: 'https://ogabassey.com/',
          lighthouseResult: {
            audits: {},
            categories: { performance: { score: 0.91 } },
          },
        };
      },
    });

    const result = await runPsi(
      { label: 'home', url: 'https://ogabassey.com/' },
      'mobile'
    );

    expect(requests[0]).toContain('runPagespeed');
    expect(requests[0]).toContain('strategy=mobile');
    expect(requests[0]).toContain('key=psi-key');
    expect(result.summary).toMatchObject({
      label: 'home',
      performance: 91,
      source: 'psi',
      strategy: 'mobile',
    });
  });
});

describe('createDebugBearRunner', () => {
  it('requires an admin API key for project discovery', async () => {
    const runner = createDebugBearRunner({ apiKey: 'project-key' });

    await expect(runner.getProjects()).rejects.toThrow(
      'Set DEBUGBEAR_ADMIN_API_KEY (or an admin key in DEBUGBEAR_API_KEY) for project discovery'
    );
  });

  it('returns DebugBear artifacts when polling times out', async () => {
    const runner = createDebugBearRunner({
      apiKey: 'project-key',
      fetchJsonImpl: (_url, init = {}) => {
        if (init.method === 'POST') return { quickTests: [{ id: 'qt-1' }] };
        return { status: 'running' };
      },
      maxPollAttempts: 1,
      pollIntervalMs: 0,
      projectId: '101919',
      sleep: () => undefined,
    });

    const result = await runner.run(
      { label: 'home', url: 'https://ogabassey.com/' },
      []
    );

    expect(result).toMatchObject({
      failure: 'DebugBear poll timed out for home after 1 attempts',
      payload: {
        created: { quickTests: [{ id: 'qt-1' }] },
        result: { status: 'running' },
      },
      summary: expect.objectContaining({
        quickTestId: 'qt-1',
        resultUrl:
          'https://www.debugbear.com/project/101919/quickTest/qt-1/overview',
      }),
    });
  });

  it('runs quick tests with the configured project, device, and us-east default region', async () => {
    const requests = [];
    const runner = createDebugBearRunner({
      apiKey: 'project-key',
      fetchJsonImpl: (url, init = {}) => {
        requests.push({ init, url });
        if (init.method === 'POST') return { quickTests: [{ id: 'qt-1' }] };
        return { error: 'Synthetic failure', status: 'failed' };
      },
      maxPollAttempts: 1,
      pollIntervalMs: 0,
      projectId: '101919',
      sleep: () => undefined,
    });

    const result = await runner.run(
      { label: 'home', url: 'https://ogabassey.com/' },
      []
    );

    expect(requests[0]).toMatchObject({
      url: 'https://www.debugbear.com/api/v1/project/101919/quickTests',
    });
    expect(JSON.parse(requests[0].init.body)).toEqual([
      {
        device: 'Mobile',
        region: 'us-east',
        url: 'https://ogabassey.com/',
      },
    ]);
    expect(requests[0].init.headers).toMatchObject({
      'x-api-key': 'project-key',
    });
    expect(result).toMatchObject({
      failure: 'Synthetic failure',
      summary: expect.objectContaining({
        label: 'home',
        source: 'debugbear',
      }),
    });
  });
});
