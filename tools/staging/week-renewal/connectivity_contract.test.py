import copy
from datetime import datetime, timezone
import unittest

import connectivity_contract as contract
from renewal_contract import Refused, TARGET_EPOCH


def evidence():
    return {
        'stage': 'lane-a-activation-evidence', 'status': 'review-required', 'readOnly': True,
        'requestedServiceDeadline': contract.TARGET, 'observedAt': '2026-09-30T18:42:52+00:00',
        **{name: False for name in contract.FALSE_FIELDS},
        **{name: {'fixture': name} for name in contract.STABLE_FIELDS},
        'fundingDatabaseRole': {'present': True, 'login': True, 'inherits': False,
            'expiresAtEpoch': None, 'coversRequestedDeadline': False, 'unsafeAuthority': False,
            'credentialsChanged': False, 'memberships': None, 'functions': []},
        'upstreams': {'auth': {'healthHttp': 200}, 'rest': {'healthHttp': 200}},
        'firewall': [{'bridge': name, 'reviewedDropRulePresent': True}
                     for name in ('baci-stg-db', 'baci-stg-mail')],
    }


class ConnectivityContractTests(unittest.TestCase):
    def test_fresh_report_must_match_reviewed_graph_routes_and_financial_fences(self):
        reviewed = evidence()
        fresh = copy.deepcopy(reviewed)
        now = int(datetime.fromisoformat(fresh['observedAt']).timestamp()) + 5
        contract.validate_fresh(reviewed, fresh, now)
        for field in contract.STABLE_FIELDS + ('fundingDatabaseRole',):
            changed = copy.deepcopy(fresh)
            changed[field] = {'drift': True}
            with self.subTest(field=field), self.assertRaises(Refused):
                contract.validate_fresh(reviewed, changed, now)

    def test_no_expired_future_or_mutating_evidence_can_activate(self):
        reviewed = evidence()
        now = int(datetime.fromisoformat(reviewed['observedAt']).timestamp())
        for delta in (-1, 121):
            with self.assertRaises(Refused):
                contract.validate_fresh(reviewed, reviewed, now + delta)
        for name in contract.FALSE_FIELDS:
            changed = {**reviewed, name: True}
            with self.subTest(name=name), self.assertRaises(Refused):
                contract.validate_fresh(reviewed, changed, now)
        with self.assertRaises(Refused):
            contract.validate_fresh(reviewed, reviewed, TARGET_EPOCH)

    def test_firewall_or_health_failure_prevents_activation(self):
        reviewed = evidence()
        now = int(datetime.fromisoformat(reviewed['observedAt']).timestamp())
        for field in ('firewall', 'upstreams'):
            changed = copy.deepcopy(reviewed)
            if field == 'firewall':
                changed[field][0]['reviewedDropRulePresent'] = False
            else:
                changed[field]['auth']['healthHttp'] = 503
            with self.assertRaises(Refused):
                contract.validate_fresh(changed, changed, now)

    def test_retry_accepts_only_the_already_bounded_role_not_arbitrary_expiry(self):
        reviewed = evidence()
        fresh = copy.deepcopy(reviewed)
        now = int(datetime.fromisoformat(reviewed['observedAt']).timestamp())
        fresh['fundingDatabaseRole'].update(expiresAtEpoch=TARGET_EPOCH, coversRequestedDeadline=True)
        contract.validate_fresh(reviewed, fresh, now)
        fresh['fundingDatabaseRole']['expiresAtEpoch'] += 1
        with self.assertRaises(Refused):
            contract.validate_fresh(reviewed, fresh, now)

    def test_deadline_stop_targets_and_effective_next_elapse_are_exact(self):
        unit = b'[Service]\nType=oneshot\nExecStart=/usr/bin/systemctl stop baci-savings-drafts.service\n'
        contract.stop_targets(unit, 'baci-savings-drafts-deadline.service')
        state = {'Unit': 'baci-savings-drafts-deadline.service', 'ActiveState': 'active',
                 'SubState': 'waiting', 'NextElapseUSecRealtime': 'Tue 2026-10-06 15:59:10 UTC',
                 'AccuracyUSec': '1s', 'RandomizedDelayUSec': '0'}
        contract.timer_schedule(state, 'baci-savings-drafts-deadline.service')
        for changed in ({**state, 'Unit': 'other.service'}, {**state, 'SubState': 'elapsed'},
                        {**state, 'NextElapseUSecRealtime': 'Tue 2026-10-13 15:59:10 UTC'},
                        {**state, 'RandomizedDelayUSec': '5min'}, {**state, 'AccuracyUSec': '1min'}):
            with self.assertRaises(Refused):
                contract.timer_schedule(changed, 'baci-savings-drafts-deadline.service')
        with self.assertRaises(Refused):
            contract.stop_targets(unit.replace(b'drafts.service', b'funding.service'),
                                  'baci-savings-drafts-deadline.service')
        with self.assertRaises(Refused):
            contract.stop_targets(unit + b'ExecStart=/bin/sh -c evil\n',
                                  'baci-savings-drafts-deadline.service')


if __name__ == '__main__':
    unittest.main()
