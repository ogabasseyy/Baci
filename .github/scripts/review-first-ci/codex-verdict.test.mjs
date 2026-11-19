import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateVerdict, shaMatches } from './codex-verdict.mjs';

const HEAD = 'd9df294247dc5e1aa215e269ad96aa3c2eeb8ca5';
const OLD = '1111111111111111111111111111111111111111';
const NEWER = '2222222222222222222222222222222222222222';

let tick = 0;
const at = () => new Date(Date.UTC(2026, 10, 11, 10, 0, tick++)).toISOString();
const item = (kind, sha, extra = {}) => ({ kind, sha, time: at(), source: 'test', id: tick, ...extra });

const evaluate = (evidence, options = {}) =>
  evaluateVerdict({
    evidence,
    headSha: HEAD,
    resolveSha: async (sha) => (sha.length === 40 ? sha : null),
    carryOver: async () => false,
    ...options,
  });

describe('shaMatches', () => {
  it('matches a full sha only exactly', () => {
    assert.equal(shaMatches(HEAD, HEAD), true);
    assert.equal(shaMatches(HEAD.toUpperCase(), HEAD), true);
    assert.equal(shaMatches(OLD, HEAD), false);
  });

  it('matches an abbreviation of at least 10 characters as a prefix of the head', () => {
    assert.equal(shaMatches('d9df294247', HEAD), true);
    assert.equal(shaMatches('d9df294', HEAD), false);
    assert.equal(shaMatches('d9df29', HEAD), false);
    assert.equal(shaMatches('d9df295', HEAD), false);
  });

  it('never matches null or empty', () => {
    assert.equal(shaMatches(null, HEAD), false);
    assert.equal(shaMatches('', HEAD), false);
  });
});

describe('verdict for the exact head commit', () => {
  it('is clean when the newest Codex item for the head is a clean verdict', async () => {
    const verdict = await evaluate([item('clean', HEAD)]);
    assert.equal(verdict.state, 'clean');
    assert.equal(verdict.carried, false);
  });

  it('accepts an abbreviated reviewed commit that is a prefix of the head', async () => {
    assert.equal((await evaluate([item('clean', 'd9df294247')])).state, 'clean');
  });

  it('is findings when findings are newer than the clean verdict on the same commit', async () => {
    const verdict = await evaluate([item('clean', HEAD), item('findings', HEAD)]);
    assert.equal(verdict.state, 'findings');
  });

  it('is clean again when a fresh clean verdict follows the findings (rebuttal then re-review)', async () => {
    const verdict = await evaluate([item('findings', HEAD), item('clean', HEAD)]);
    assert.equal(verdict.state, 'clean');
  });

  it('waits while a review of the head is running', async () => {
    const verdict = await evaluate([item('clean', HEAD), item('running', HEAD)]);
    assert.equal(verdict.state, 'running');
  });

  it('treats a running review that names no commit as running for the head', async () => {
    assert.equal((await evaluate([item('running', null)])).state, 'running');
  });

  it('ignores a running review of some other commit', async () => {
    assert.equal((await evaluate([item('running', OLD)])).state, 'none');
  });

  it('is none when Codex has said nothing', async () => {
    const verdict = await evaluate([]);
    assert.equal(verdict.state, 'none');
    assert.match(verdict.reason, /no Codex/i);
  });

  it('says so when Codex only reported a usage limit', async () => {
    const verdict = await evaluate([item('unavailable', null)]);
    assert.equal(verdict.state, 'none');
    assert.match(verdict.reason, /usage limit/i);
  });
});

describe('verdict for a different commit (stale verdicts)', () => {
  it('does not reuse a clean verdict for an older commit when the diff changed', async () => {
    const verdict = await evaluate([item('clean', OLD)], { carryOver: async () => false });
    assert.equal(verdict.state, 'none');
    assert.match(verdict.reason, /different commit/i);
  });

  it('reuses it only when the net diff is provably identical', async () => {
    const seen = [];
    const verdict = await evaluate([item('clean', OLD)], {
      carryOver: async (from, to) => {
        seen.push([from, to]);
        return true;
      },
    });
    assert.equal(verdict.state, 'clean');
    assert.equal(verdict.carried, true);
    assert.deepEqual(seen, [[OLD, HEAD]]);
  });

  it('resolves an abbreviated old commit before comparing', async () => {
    const seen = [];
    const verdict = await evaluate([item('clean', '1111111111')], {
      resolveSha: async () => OLD,
      carryOver: async (from) => {
        seen.push(from);
        return true;
      },
    });
    assert.equal(verdict.state, 'clean');
    assert.deepEqual(seen, [OLD]);
  });

  it('fails closed when the old abbreviated commit cannot be resolved', async () => {
    const verdict = await evaluate([item('clean', '1111111111')], { resolveSha: async () => null, carryOver: async () => true });
    assert.equal(verdict.state, 'none');
  });

  it('fails closed when the comparison throws', async () => {
    const verdict = await evaluate([item('clean', OLD)], {
      carryOver: async () => {
        throw new Error('HTTP 404');
      },
    });
    assert.equal(verdict.state, 'none');
    assert.match(verdict.reason, /could not prove/i);
  });

  it('only looks at the newest verdict for another commit', async () => {
    const calls = [];
    const verdict = await evaluate([item('clean', OLD), item('findings', NEWER)], {
      carryOver: async (from) => {
        calls.push(from);
        return from === OLD;
      },
    });
    assert.deepEqual(calls, [NEWER]);
    assert.equal(verdict.state, 'none');
  });

  it('carries findings forward when the newest verdict for another commit was findings on the same net diff', async () => {
    const verdict = await evaluate([item('clean', OLD), item('findings', NEWER)], { carryOver: async () => true });
    assert.equal(verdict.state, 'findings');
    assert.equal(verdict.carried, true);
  });

  it('prefers an exact verdict for the head over anything older', async () => {
    const verdict = await evaluate([item('clean', OLD), item('findings', HEAD)], { carryOver: async () => true });
    assert.equal(verdict.state, 'findings');
    assert.equal(verdict.carried, false);
  });
});

it('requires net-diff proof for a matching seven-character receipt', async () => {
  const evidence = [item('clean', HEAD.slice(0, 7))];
  const rejected = await evaluate(evidence, { resolveSha: async () => OLD });
  assert.equal(rejected.state, 'none');
  let checked = false;
  const proven = await evaluate(evidence, {
    resolveSha: async () => OLD,
    carryOver: async (from, to) => {
      assert.equal(from, OLD);
      assert.equal(to, HEAD);
      checked = true;
      return true;
    },
  });
  assert.equal(checked, true);
  assert.equal(proven.carried, true);
});

for (const kind of ['findings', 'running']) {
  it(`a newer short ${kind} receipt blocks an older full-SHA clean verdict`, async () => {
    const result = await evaluate([item('clean', HEAD), item(kind, HEAD.slice(0, 7))]);
    assert.equal(result.state, kind);
  });
}
