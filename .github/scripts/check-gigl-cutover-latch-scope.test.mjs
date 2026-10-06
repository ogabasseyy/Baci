import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  check,
  checkoutAt,
  cleanupLatchFixtures,
  fixture,
} from './check-gigl-cutover-latch.test-fixtures.mjs';

afterEach(cleanupLatchFixtures);

describe('GIGL cutover latch scope and token binding', () => {
  it('accepts a disabled latch while the worker is still disabled', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
      envFile: 'GIGL_ENABLED=off\n',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('invalidates a disabled latch once the worker is re-enabled', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Same latch content as the steady-disabled case; only the live .env
    // changed. A disabled smoke must never certify future enabled
    // function, so only the scope re-check fails closed here.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
      envFile: 'GIGL_ENABLED=1\nGIGL_TRACKING_WORKER_TOKEN=aaa.bbb.ccc\n',
      token: '',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates a disabled latch when the env file disappears', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Absent .env means enabled, which mismatches the disabled scope.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates an enabled latch once the worker is disabled', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // Scope must match in BOTH directions: without this, a
    // disable/re-enable cycle between latch and push would bypass the
    // smoke on an unproven token.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile: 'GIGL_ENABLED=false\n',
      token: '',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates an enabled latch when the token rotates', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile: 'GIGL_TRACKING_WORKER_TOKEN=new-token\n',
      token: 'old-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates an enabled latch when the token is removed', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile: 'GIGL_ENABLED=1\n',
      token: 'old-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates a vacuous disabled latch when a token appears', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // The latch was written with no usable token, hence WITHOUT the live
    // hook probe. A token provisioned afterwards while still disabled
    // must force a re-smoke: the vacuous latch cannot certify a JWT the
    // hook never confined.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
      envFile: 'GIGL_ENABLED=off\nGIGL_TRACKING_WORKER_TOKEN=new-token\n',
      token: '',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('invalidates a disabled latch when its token rotates', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
      envFile: 'GIGL_ENABLED=off\nGIGL_TRACKING_WORKER_TOKEN=new-token\n',
      token: 'old-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('accepts a disabled latch while its token is unchanged', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'disabled',
      envFile: 'GIGL_ENABLED=off\nGIGL_TRACKING_WORKER_TOKEN=same-token\n',
      token: 'same-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('invalidates a latch when the endpoint moves but the token does not', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile:
        'NEXT_PUBLIC_SUPABASE_URL=https://new.supabase.co\nGIGL_TRACKING_WORKER_TOKEN=same-token\n',
      token: 'same-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });

  it('accepts a latch while provider credentials are unchanged', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile:
        'GIGL_BASE_URL=https://api.gigl.test\nGIGL_EMAIL=bot@test\nGIGL_PASSWORD=pw\nGIGL_TRACKING_WORKER_TOKEN=same-token\n',
      token: 'same-token',
      providerBase: 'https://api.gigl.test',
      providerEmail: 'bot@test',
      providerPassword: 'pw',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'true');
    assert.equal(values.tracking_stale, 'false');
  });

  it('invalidates a latch when the provider password rotates', () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);

    // The smoke probed the provider login, so a rotation afterwards
    // must force a re-smoke even though the worker token is unchanged.
    const { result, values } = check({
      checkout,
      latch: tip,
      scope: 'enabled',
      envFile:
        'GIGL_BASE_URL=https://api.gigl.test\nGIGL_EMAIL=bot@test\nGIGL_PASSWORD=new-pw\nGIGL_TRACKING_WORKER_TOKEN=same-token\n',
      token: 'same-token',
      providerBase: 'https://api.gigl.test',
      providerEmail: 'bot@test',
      providerPassword: 'old-pw',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(values.latched, 'false');
    assert.equal(values.tracking_stale, 'true');
  });
});
