import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPublicNginxWorkers } from './managed-nginx-worker-selection.mjs';

const processes = `
41 1 baci-savings-gateway nginx
42 41 baci-savings-gateway nginx
100 1 root nginx
101 100 www-data nginx
102 100 www-data nginx
`;

test('selects only direct non-root workers of the verified public nginx MainPID', () => {
  assert.deepEqual(selectPublicNginxWorkers(processes, '100'), [
    { pid: '101', user: 'www-data' },
    { pid: '102', user: 'www-data' },
  ]);
});

test('rejects malformed MainPIDs and malformed process records', () => {
  for (const mainPid of ['0', '-1', '100x', '', ' 100'])
    assert.throws(() => selectPublicNginxWorkers(processes, mainPid));
  for (const output of [
    '100 1 root nginx\n101 100 www-data',
    '100 1 root nginx\n101 100 www-data nginx extra',
    '100 1 root nginx\n01 100 www-data nginx',
    '100 1 root nginx\n101 zero www-data nginx',
  ])
    assert.throws(() => selectPublicNginxWorkers(output, '100'));
});

test('rejects an absent public master or a public master without direct workers', () => {
  assert.throws(() => selectPublicNginxWorkers(processes, '999'));
  assert.throws(() =>
    selectPublicNginxWorkers('100 1 root nginx\n101 1 www-data nginx', '100')
  );
});
