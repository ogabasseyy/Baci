import json
from pathlib import Path
import unittest
from unittest.mock import patch

import owner_database as owner


class DatabaseOwnerTests(unittest.TestCase):
    def records(self):
        sql=b'pinned sql'
        metadata={'bindingHash':'b'*64,'rolesHash':'c'*64,'tableHash':'d'*64,'protectedHash':'e'*64,
                  'bindingExpiry':'2026-09-29T15:59:10Z','roleExpiry':'2026-09-29T15:59:10Z'}
        return sql,metadata,{
            'commit-result.json':{'status':'applied','protectedStateUnchanged':True,
                'passwordsPrivilegesMembershipUnchanged':True,'newPaymentStarted':False,
                'publicMutationsEnabled':False,'sqlSha256':owner.digest(sql)},
            'rehearsal-result.json':{'status':'rollback_rehearsal_passed','databaseSqlSha256':owner.digest(sql),
                'rollbackConfirmed':True,'protectedStateUnchanged':True},
            'candidate.json':{'databaseSqlSha256':owner.digest(sql)},
            'snapshot-baseline.json':{'metadata':metadata},
            'snapshot-commit-result.json':{'status':'applied','sqlSha256':owner.digest(sql),
                'passwordPrivilegesMembershipUnchanged':True,'immutableTriggerRestored':True},
            'snapshot-rehearsal-result.json':{'status':'rollback_rehearsal_passed',
                'sqlSha256':owner.digest(sql),'triggerRestored':True},
        }

    def proof(self, roles_changed=False, trigger_changed=False, prior=None):
        sql,metadata,records=self.records()
        if trigger_changed:records['snapshot-commit-result.json']['immutableTriggerRestored']=False
        current={**metadata,'bindingExpiry':owner.DEADLINE,'roleExpiry':owner.DEADLINE}
        roles={name:{'expiresAt':owner.DEADLINE,'unsafe':False} for name in owner.ROLES}
        results=['b'*64 if roles_changed else 'a'*64,json.dumps({'metadata':current}),json.dumps(roles)]
        with patch.object(owner,'private_json',side_effect=lambda path:records[path.name]), \
                patch.object(owner,'read_file',side_effect=lambda path,*args:
                    (prior if prior is not None else ('a'*64).encode())
                    if path.name=='roles-before-sha256.txt' else sql):
            return owner.renewal_proof(Path('/root/audit'),query=lambda sql:results.pop(0))

    def test_rehearsed_commit_requires_actual_role_and_binding_readback(self):
        report=self.proof()
        self.assertTrue(report['guardedRenewalCommitted'])
        self.assertEqual(set(report['roles']),set(owner.ROLES))

    def test_password_acl_or_membership_drift_refuses_even_when_commit_report_says_success(self):
        with self.assertRaisesRegex(ValueError,'executor_fingerprint_changed'):
            self.proof(roles_changed=True)

    def test_immutable_trigger_must_be_restored(self):
        with self.assertRaisesRegex(ValueError,'snapshot_fingerprint_changed'):
            self.proof(trigger_changed=True)

    def test_fingerprint_newline_is_normalized_but_non_digest_refuses(self):
        self.assertTrue(self.proof(prior=('a'*64+'\n').encode())['guardedRenewalCommitted'])
        with self.assertRaisesRegex(ValueError, 'executor_fingerprint_invalid'):
            self.proof(prior=b'not-a-digest')


if __name__=='__main__':
    unittest.main()
