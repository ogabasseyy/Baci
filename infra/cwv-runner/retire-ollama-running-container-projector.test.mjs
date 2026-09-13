import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { installDockerStub } from './running-container-fixture.mjs';

const shell = await readFile(
  new URL('./retire-ollama-running-container.sh', import.meta.url),
  'utf8'
);
const validation = await readFile(
  new URL('./retire-ollama-running-container-validation.sh', import.meta.url),
  'utf8'
);
const projectorAuth = await readFile(
  new URL('./retire-ollama-projector-auth.sh', import.meta.url),
  'utf8'
);

test('fails explicitly when a Docker fixture function is absent', async () => {
  await assert.rejects(
    installDockerStub('/tmp', 'load_consumer_scanners;'),
    /fixture docker function is missing/
  );
});

test('publishes a fixed image-projection phase for projector status two', () => {
  assert.match(
    validation,
    /running_match_status=\$\?;[^\n]*image-projection 2/
  );
  assert.match(
    shell,
    /image-projection\|inventory-refresh/
  );
});

test('binds projector execution to an O_NOFOLLOW identity snapshot', () => {
  assert.match(
    projectorAuth,
    /sysopen\(my\$source,\$projector,O_RDONLY\|O_NOFOLLOW\)/
  );
  assert.match(
    projectorAuth,
    /same\(\\@before,\\@opened\)&&same\(\\@opened,\\@after\)/
  );
  assert.match(
    projectorAuth,
    /my@final=lstat\(\$projector\); same\(\\@opened,\\@final\) or \$terminate->\(\)/
  );
});

test('loads projector authorization through the held-source digest binding', () => {
  assert.match(shell, /source_loader_source "\$PROJECTOR_AUTH_HELPER"/);
  assert.match(shell, /PROJECTOR_AUTH_HELPER_SHA=\$SOURCE_LOADER_DIGEST/);
  assert.match(shell, /RECOVERY_PROJECTOR_AUTH_SHA/);
  assert.doesNotMatch(shell, /&& \. "\$PROJECTOR_AUTH_HELPER"/);
});

test('passes a validated caller deadline to projector execution', () => {
  assert.match(
    shell,
    /running_image_deadline=\$\{2-\}[\s\S]*case "\$running_image_deadline" in ''\|\*\[!0-9\]\*\)/
  );
  assert.match(
    shell,
    /\[ "\$running_image_now" -lt "\$running_image_deadline" \]/
  );
  assert.match(
    validation,
    /running_image_projection_started_at=\$\(running_container_now\)[\s\S]*running_image_projection_deadline=\$\(\(running_image_projection_started_at \+ RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS\)\)[\s\S]*running_container_image_matches_merged "\$running_image_save_first" "\$running_image_projection_deadline"/
  );
});
