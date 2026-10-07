#!/usr/bin/env python3
"""Unit tests for the staging verification orchestrator (no network, no token)."""

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def _load():
    spec = importlib.util.spec_from_file_location(
        'funding_staging_verify', HERE / 'funding-staging-verify.py'
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verify = _load()


def _stub(calls, outcomes):
    """Scenario double: records calls, replays canned (ok, *data) outcomes."""

    def make(name, arity):
        def fn(record, *args):
            calls.append(name)
            record(name, 'pass')
            return outcomes[name]

        assert len(outcomes[name]) == arity, name
        return fn

    return SimpleNamespace(
        discover_product=make('discover-product', 2),
        discover_variant=make('discover-variant', 3),
        list_baseline=make('list-baseline', 2),
        create_goal=make('create-goal', 2),
        check_persisted=make('goal-persisted', 1),
        check_contribution_idempotency=make('idempotency', 2),
        check_goal_key_idempotency=make('goal-idempotency', 1),
        check_funding_account=make('funding-account', 1),
    )


PASS = {
    'discover-product': (True, 'product-1'),
    'discover-variant': (True, 'variant-1', 50000),
    'list-baseline': (True, set()),
    'create-goal': (True, 'goal-a'),
    'goal-persisted': (True,),
    'idempotency': (True, 2),
    'goal-idempotency': (True,),
    'funding-account': (True,),
}


class RunOrchestratorTest(unittest.TestCase):
    def test_run_executes_every_scenario_in_order(self):
        calls = []
        with patch.object(verify, 'scenarios', _stub(calls, PASS)):
            steps = verify.run('a', 'r', 't', 'm', None, 15)

        self.assertEqual(
            calls,
            [
                'discover-product',
                'discover-variant',
                'list-baseline',
                'create-goal',
                'goal-persisted',
                'idempotency',
                'goal-idempotency',
                'funding-account',
            ],
        )
        self.assertEqual([step['step'] for step in steps], calls)

    def test_run_short_circuits_after_the_first_failure(self):
        calls = []
        outcomes = dict(PASS)
        outcomes['discover-variant'] = (False, None, 0)
        with patch.object(verify, 'scenarios', _stub(calls, outcomes)):
            steps = verify.run('a', 'r', 't', 'm', None, 15)

        self.assertEqual(calls, ['discover-product', 'discover-variant'])
        self.assertEqual(len(steps), 2)

    def test_run_continues_when_idempotency_skips(self):
        calls = []
        outcomes = dict(PASS)
        outcomes['idempotency'] = (True, 1)
        with patch.object(verify, 'scenarios', _stub(calls, outcomes)):
            steps = verify.run('a', 'r', 't', 'm', None, 15)

        self.assertIn('goal-idempotency', calls)
        self.assertIn('funding-account', calls)
        self.assertEqual(len(steps), 8)


if __name__ == '__main__':
    unittest.main()
