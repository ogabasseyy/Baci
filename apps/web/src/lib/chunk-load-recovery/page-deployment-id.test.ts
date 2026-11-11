// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { getPageDeploymentId } from './page-deployment-id';

const NEXT_DEPLOYMENT_ID_GLOBAL = 'NEXT_DEPLOYMENT_ID';

describe('getPageDeploymentId', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, NEXT_DEPLOYMENT_ID_GLOBAL);
    delete document.documentElement.dataset.dplId;
    document.head.innerHTML = '';
  });

  it('prefers the Next deployment id global', () => {
    Object.defineProperty(globalThis, NEXT_DEPLOYMENT_ID_GLOBAL, {
      configurable: true,
      value: 'next-global-deploy',
    });
    document.documentElement.dataset.dplId = 'dataset-deploy';

    expect(getPageDeploymentId()).toBe('next-global-deploy');
  });

  it('falls back to the data-dpl-id attribute', () => {
    document.documentElement.dataset.dplId = 'dataset-deploy';

    expect(getPageDeploymentId()).toBe('dataset-deploy');
  });

  it('uses the dpl query of loaded Next assets before hashing', () => {
    document.head.innerHTML =
      '<script src="/_next/static/chunks/app-abc.js?dpl=deploy-123"></script>';

    expect(getPageDeploymentId()).toBe('dpl:deploy-123');
  });

  it('hashes loaded Next asset urls when no dpl query exists', () => {
    document.head.innerHTML =
      '<script src="/_next/static/chunks/app-abc.js"></script>';

    expect(getPageDeploymentId()).toMatch(/^assets-[a-z0-9]+$/);
  });

  it('reports unknown-deployment when nothing is derivable', () => {
    expect(getPageDeploymentId()).toBe('unknown-deployment');
  });
});
