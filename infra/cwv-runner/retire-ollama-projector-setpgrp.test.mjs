import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const helper = new URL('./retire-ollama-projector-auth.sh', import.meta.url);

test('accepts a successful zero setpgrp return before launching the projector', async () => {
  const source = await readFile(helper, 'utf8');

  assert.match(
    source,
    /my\$pgrp=setpgrp\(0,0\);defined\(\$pgrp\)&&\$pgrp>=0 or die;/
  );
  assert.doesNotMatch(source, /setpgrp\(0,0\)or die/);
});
