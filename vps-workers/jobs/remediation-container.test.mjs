import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('remediation container', () => {
  it('uses a glibc image compatible with mounted VPS dependencies', () => {
    const dockerfile = readFileSync(
      join(workerRoot, 'Dockerfile.codex-remediator'),
      'utf8'
    );

    assert.match(dockerfile, /^FROM node:24-bookworm-slim@sha256:/);
    assert.doesNotMatch(dockerfile, /alpine|apk add/);
    assert.match(
      dockerfile,
      /^ENV COREPACK_HOME=\/usr\/local\/share\/corepack$/m
    );
    assert.match(dockerfile, /chmod -R a\+rX "\$COREPACK_HOME"/);
    assert.match(dockerfile, /bash=5\.2\.15-2\+b13/);
    assert.match(dockerfile, /ca-certificates=20230311\+deb12u1/);
    assert.match(dockerfile, /git=1:2\.39\.5-0\+deb12u3/);
  });

  it('excludes staged environment secrets from the Docker build context', () => {
    const dockerignore = readFileSync(
      join(workerRoot, '.dockerignore'),
      'utf8'
    );

    assert.match(dockerignore, /^\.env$/m);
    assert.match(dockerignore, /^\.env\.\*$/m);
  });

  it('preserves a real shell for the read-only wrapper launch', () => {
    const dockerfile = readFileSync(
      join(workerRoot, 'Dockerfile.codex-remediator'),
      'utf8'
    );

    assert.match(
      dockerfile,
      /cp \/bin\/dash \/usr\/local\/libexec\/baci-real-dash/
    );
    assert.match(
      dockerfile,
      /cp \/bin\/bash \/usr\/local\/libexec\/baci-real-bash/
    );
    assert.match(
      dockerfile,
      /cp \/bin\/bash \/usr\/local\/libexec\/baci-shell-bash/
    );
    assert.match(
      dockerfile,
      /cp \/bin\/dash \/usr\/local\/libexec\/baci-shell-dash/
    );
  });
});
