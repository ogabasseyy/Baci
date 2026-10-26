// @vitest-environment node
import { expect, it } from 'vitest';
import { assessBuilderRelease } from '../../tools/builder-release/release-gate';

it('never grants GO from local tests or an unverified endpoint', () => {
  const result = assessBuilderRelease({
    sha: 'a'.repeat(40),
    checks: { localLifecycle: true, rootLint: true, rootTypecheck: true },
    endpoint: 'https://builder-mcp-staging.usebaci.com/builder/mcp',
  });
  expect(result.go).toBe(false);
  expect(result.missing).toContain('chatgptHost');
  expect(result.missing).toContain('privacyCutover');
});
it('binds each accepted evidence item to the exact SHA and all eight tools', () => {
  const checks = Object.fromEntries(
    [
      'localLifecycle',
      'rootLint',
      'rootTypecheck',
      'rootTests',
      'postgres17Replay',
      'privacyCutover',
      'oauthPersistence',
      'stagingDeployment',
      'chatgptHost',
      'publicDelivery',
      'rollback',
      'packageInspection',
      'codexReview',
    ].map((name) => [name, true])
  );
  expect(
    assessBuilderRelease({
      sha: 'a'.repeat(40),
      evidenceSha: 'b'.repeat(40),
      checks,
      toolCount: 8,
      endpoint: 'https://builder-mcp-staging.usebaci.com/builder/mcp',
    }).go
  ).toBe(false);
  expect(
    assessBuilderRelease({
      sha: 'a'.repeat(40),
      evidenceSha: 'a'.repeat(40),
      checks,
      toolCount: 7,
      endpoint: 'https://builder-mcp-staging.usebaci.com/builder/mcp',
    }).go
  ).toBe(false);
});

it('qualified staging evidence still does not authorize production or submission changes', () => {
  const checks = Object.fromEntries(
    [
      'localLifecycle',
      'rootLint',
      'rootTypecheck',
      'rootTests',
      'postgres17Replay',
      'privacyCutover',
      'oauthPersistence',
      'stagingDeployment',
      'chatgptHost',
      'publicDelivery',
      'rollback',
      'packageInspection',
      'codexReview',
    ].map((name) => [name, true])
  );
  expect(
    assessBuilderRelease({
      sha: 'a'.repeat(40),
      evidenceSha: 'a'.repeat(40),
      checks,
      toolCount: 8,
      endpoint: 'https://builder-mcp-staging.usebaci.com/builder/mcp',
    })
  ).toMatchObject({
    go: true,
    productionDeploymentAuthorized: false,
    submissionChangesAuthorized: false,
  });
});

it('keeps the checked-in deployment contract disabled until every service exists', async () => {
  const { readFile } = await import('node:fs/promises');
  const contract = JSON.parse(
    await readFile(
      new URL(
        '../../tools/builder-release/deployment-contract.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  expect(contract.activation).toBe('disabled');
  expect(contract.automaticTriggers).toEqual([]);
  for (const name of ['auth', 'web', 'editRunner', 'verifier'])
    expect(contract.entrypoints[name]).toMatchObject({ ready: false });
});
