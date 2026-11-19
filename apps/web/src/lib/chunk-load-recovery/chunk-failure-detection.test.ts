// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  detectChunkFailureFromResourceTarget,
  detectChunkFailureFromValue,
} from './chunk-failure-detection';

describe('detectChunkFailureFromValue', () => {
  it('detects Turbopack ChunkLoadError and extracts the asset url and dpl', () => {
    const error = new Error(
      'Failed to load chunk /_next/static/chunks/0ge04sv00ywwm.js?dpl=28553955983_1_536baebf3cfac3f6ff from module 481111'
    );
    error.name = 'ChunkLoadError';

    const details = detectChunkFailureFromValue(error);

    expect(details).toEqual({
      failedAssetDeploymentId: '28553955983_1_536baebf3cfac3f6ff',
      failedAssetUrl:
        '/_next/static/chunks/0ge04sv00ywwm.js?dpl=28553955983_1_536baebf3cfac3f6ff',
    });
  });

  it('detects absolute chunk urls in messages', () => {
    const details = detectChunkFailureFromValue(
      'ChunkLoadError: Failed to load chunk https://ogabassey.com/_next/static/chunks/app.js?dpl=deploy-9 from module 1'
    );

    expect(details?.failedAssetUrl).toBe(
      'https://ogabassey.com/_next/static/chunks/app.js?dpl=deploy-9'
    );
    expect(details?.failedAssetDeploymentId).toBe('deploy-9');
  });

  it('detects webpack named chunk failures without an embedded url', () => {
    const details = detectChunkFailureFromValue(
      new Error('Loading chunk app/layout failed.')
    );

    expect(details).toEqual({
      failedAssetDeploymentId: null,
      failedAssetUrl: null,
    });
  });

  it('detects webpack CSS chunk failures', () => {
    const details = detectChunkFailureFromValue(
      new Error('Loading CSS chunk 170 failed.\n(/_next/static/css/layout.css)')
    );

    expect(details?.failedAssetUrl).toBe('/_next/static/css/layout.css');
  });

  it('detects native ESM dynamic import failures', () => {
    expect(
      detectChunkFailureFromValue(
        new TypeError('Failed to fetch dynamically imported module: https://x')
      )
    ).not.toBeNull();
    expect(
      detectChunkFailureFromValue(
        new TypeError('Importing a module script failed.')
      )
    ).not.toBeNull();
    expect(
      detectChunkFailureFromValue(
        new TypeError('error loading dynamically imported module')
      )
    ).not.toBeNull();
  });

  it('detects plain-object rejection reasons via own properties only', () => {
    const inherited = Object.create({
      message: 'ChunkLoadError from the prototype',
    }) as object;

    expect(detectChunkFailureFromValue(inherited)).toBeNull();
    expect(
      detectChunkFailureFromValue({
        message: 'Failed to load chunk /_next/static/chunks/app.js',
        name: 'ChunkLoadError',
      })
    ).not.toBeNull();
  });

  it('ignores unrelated errors and non-error values', () => {
    expect(
      detectChunkFailureFromValue(
        new Error('maximumFractionDigits value is out of range')
      )
    ).toBeNull();
    expect(detectChunkFailureFromValue(undefined)).toBeNull();
    expect(detectChunkFailureFromValue(42)).toBeNull();
  });

  it('does not treat chunk urls in Error stacks as chunk failures', () => {
    const error = new Error('Cannot read properties of undefined');
    error.stack = `Error: Cannot read properties of undefined\n    at https://ogabassey.com/_next/static/chunks/app.js:1:1`;

    expect(detectChunkFailureFromValue(error)).toBeNull();
  });

  it('does not treat chunk urls in a plain object stack as chunk failures', () => {
    const details = detectChunkFailureFromValue({
      name: 'CustomError',
      message: 'unrelated failure',
      stack: 'at https://x/_next/static/chunks/app.js:1:1',
    });

    expect(details).toBeNull();
  });
});

describe('detectChunkFailureFromResourceTarget', () => {
  it('detects failing Next script elements', () => {
    const script = document.createElement('script');
    script.src = '/_next/static/chunks/page-abc.js?dpl=deploy-7';

    const details = detectChunkFailureFromResourceTarget(script);

    expect(details?.failedAssetUrl).toContain(
      '/_next/static/chunks/page-abc.js'
    );
    expect(details?.failedAssetDeploymentId).toBe('deploy-7');
  });

  it('detects failing Next stylesheet links', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/_next/static/css/layout-def.css?dpl=deploy-7';

    expect(detectChunkFailureFromResourceTarget(link)).not.toBeNull();
  });

  it('ignores non-Next resources and non-resource targets', () => {
    const script = document.createElement('script');
    script.src = 'https://cdn.example.com/widget.js';
    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.href = '/_next/static/chunks/later.js';
    const image = document.createElement('img');

    expect(detectChunkFailureFromResourceTarget(script)).toBeNull();
    expect(detectChunkFailureFromResourceTarget(preload)).toBeNull();
    expect(detectChunkFailureFromResourceTarget(image)).toBeNull();
    expect(detectChunkFailureFromResourceTarget(window)).toBeNull();
    expect(detectChunkFailureFromResourceTarget(null)).toBeNull();
  });
});
