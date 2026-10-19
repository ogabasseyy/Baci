import copy
import unittest

import mutation_contract
import mutation_chain as chain
from source_functions import APP_SYSTEM, GOAL_ID, SEALED


def baseline():
    return {'systemIdentifier': APP_SYSTEM, 'readOnly': True,
        'goal': {'id': GOAL_ID, 'current_amount': 100, 'goal_kind': 'legacy',
            'source_mode': 'manual', 'status': 'active'},
        'intent': {'id': mutation_contract.INTENT, 'phase': 'retired_unconfirmed',
            'amountKobo': 10000, 'expiresAt': '2026-09-29T15:59:10Z'},
        'operation': {'retired': True, 'collection': 'pending', 'transfer': 'not_started',
            'projection': 'unapplied'}, 'intentCount': 1, 'operationCount': 1, 'retirementCount': 1,
        'companyTotalKobo': 10000, 'treasury': {'available': 10000, 'reserved': 0,
            'consumed': 0, 'enabled': True}, 'securitySha256': 'a' * 64,
        'routines': {signature: {'bodyMd5': value['newBodyMd5'], 'owner': value['owner'],
            'language': value['language'], 'definer': value['securityDefiner'],
            'config': value['configuration'], 'acl': value['acl']}
            for signature, value in SEALED['functions'].items()}}


class ChainTests(unittest.TestCase):
    def test_retired_intent_is_preserved_and_total_company_budget_is_bounded(self):
        value = baseline()
        self.assertEqual(chain.validate(value), chain.digest(value))

    def test_retired_or_zero_intent_baselines_cannot_be_silently_reset(self):
        for changes in ({'intentCount': 0}, {'intentCount': 2}, {'operationCount': 0},
                        {'companyTotalKobo': 20000}, {'companyTotalKobo': True}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                chain.validate({**baseline(), **changes})

    def test_old_expiry_routine_or_acl_change_refuses(self):
        for field, replacement in (('bodyMd5', 'old'), ('acl', '{}'), ('definer', False)):
            value = baseline()
            signature = next(iter(value['routines']))
            value['routines'][signature][field] = replacement
            with self.subTest(field=field), self.assertRaises(ValueError):
                chain.validate(value)

    def test_full_chain_digest_changes_for_security_and_history_drift(self):
        value = baseline()
        changed = copy.deepcopy(value)
        changed['securitySha256'] = 'b' * 64
        self.assertNotEqual(chain.digest(value), chain.digest(changed))

    def test_query_is_read_only_and_pins_identity_and_all_security_layers(self):
        sql = chain.sql()
        self.assertTrue(sql.startswith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;'))
        self.assertTrue(sql.endswith('ROLLBACK;\n'))
        for required in ('pg_control_system()', 'pg_policy', 'pg_trigger', 'pg_constraint',
                         'pg_index', 'pg_get_functiondef', mutation_contract.INTENT):
            self.assertIn(required, sql)
        for forbidden in ('UPDATE ', 'INSERT ', 'DELETE ', 'ALTER ', 'COMMIT;'):
            self.assertNotIn(forbidden, sql)


if __name__ == '__main__':
    unittest.main()
