import assert from 'node:assert/strict';
import test from 'node:test';
import {
  experienceSqlCommands,
  privateQualificationCommands,
} from './commands.mjs';

test('local qualification cannot select arbitrary commands or skip required browser coverage', () => {
  assert.throws(() => experienceSqlCommands(['shell']));
  assert.equal(experienceSqlCommands().length, 2);
  assert.equal(experienceSqlCommands(['jobs']).length, 1);
  const commands = privateQualificationCommands();
  assert.equal(commands.length, 4);
  assert.equal(commands[3][1].includes('--grep'), false);
  assert.equal(commands[3][1].includes('--pass-with-no-tests'), false);
});

test('publication fixture selection includes the candidate-finalization regression and actual normal-role approval journey', () => {
  const command = experienceSqlCommands(['publication'])[0][1];
  assert.ok(command.includes('publication|jobs'));
  assert.ok(
    command.includes('tools/experience-sql/draft-approval.node.test.ts')
  );
  assert.ok(command.includes('tools/experience-sql/jobs.node.test.ts'));
  assert.ok(
    command.includes('tools/experience-sql/job-connection-binding.node.test.ts')
  );
});
