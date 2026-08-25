import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';

const { extractIfBranches } = serializedInventoryBranches;
const targetIf = /^\s*IF\s+v_target_status\s*=\s*'available'\s+THEN\b/i;

test('does not mistake CASE ELSE for the target IF branch', () => {
  const branches = extractIfBranches(
    [
      "IF v_target_status = 'available' THEN",
      '  v_label := CASE v_state',
      "    WHEN 'ready' THEN 'ready'",
      "    ELSE 'other'",
      '  END;',
      '  PERFORM lock_available_units();',
      'ELSE',
      '  PERFORM release_reserved_units();',
      'END IF;',
    ].join('\n'),
    targetIf
  );

  assert.match(branches.thenBranch, /lock_available_units/);
  assert.match(branches.elseBranch, /release_reserved_units/);
});

test('tracks a same-line SQL CASE expression through its END token', () => {
  const branches = extractIfBranches(
    [
      "IF v_target_status = 'available' THEN",
      "  v_label := CASE WHEN v_state = 'ready' THEN 'ready' ELSE 'other' END;",
      '  PERFORM lock_available_units();',
      'ELSE',
      '  PERFORM release_reserved_units();',
      'END IF;',
    ].join('\n'),
    targetIf
  );

  assert.match(branches.thenBranch, /lock_available_units/);
  assert.match(branches.elseBranch, /release_reserved_units/);
});

test('keeps ELSIF arms out of the available release branch', () => {
  const branches = extractIfBranches(
    [
      "IF v_target_status = 'available' THEN",
      '  NULL;',
      "ELSIF v_target_status = 'returned' THEN",
      '  PERFORM lock_available_units();',
      'ELSE',
      '  PERFORM release_reserved_units();',
      'END IF;',
    ].join('\n'),
    targetIf
  );

  assert.doesNotMatch(branches.thenBranch, /lock_available_units/);
  assert.match(branches.elsifBranches[0], /lock_available_units/);
});
