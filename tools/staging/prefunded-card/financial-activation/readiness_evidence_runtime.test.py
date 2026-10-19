import copy
import json
import unittest

import readiness_evidence_runtime as runtime
from runtime_scheduler import container_contract
from replay_cutover_runtime import expected_container

SEAL = 'a' * 64


class RuntimeEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.values = {
            'baci-prefunded-readiness': container_contract('readiness', SEAL),
            runtime.REPLAY + '-check': expected_container('/opt/baci-prefunded-replay', SEAL, True)}
        for value in self.values.values():
            value['State'] = {'Running': False, 'ExitCode': 0}

    def execute(self, args):
        self.events.append(args)
        name = args[-1]
        if 'inspect' in args:
            return json.dumps([self.values[name]])
        return json.dumps(runtime.TLS if name == 'baci-prefunded-readiness' else runtime.REPLAY_READY)

    def test_starts_only_exact_check_containers_with_seal_labels(self):
        result = runtime.collect(SEAL, SEAL, self.execute)
        self.assertTrue(result['replayConfigurationChecked'])
        started = [args[-1] for args in self.events if 'start' in args]
        self.assertEqual(started, ['baci-prefunded-readiness', runtime.REPLAY + '-check'])
        self.assertNotIn(runtime.REPLAY, started)

    def test_wrong_label_mount_privileged_state_or_live_check_is_refused_before_start(self):
        for mutation in ('label', 'privileged', 'mount', 'running'):
            self.setUp()
            value = self.values['baci-prefunded-readiness']
            if mutation == 'label':
                value['Config']['Labels']['com.baci.prefunded.worker-manifest'] = 'b' * 64
            elif mutation == 'privileged':
                value['HostConfig']['Privileged'] = True
            elif mutation == 'mount':
                value['Mounts'][0]['RW'] = True
            else:
                value['State']['Running'] = True
            with self.subTest(mutation=mutation), self.assertRaises(Exception):
                runtime.collect(SEAL, SEAL, self.execute)
            self.assertFalse(any('start' in args for args in self.events))

    def test_financial_state_checks_all_worker_isolation_and_disabled_schedules(self):
        self.values = {runtime.REPLAY: expected_container('/opt/baci-prefunded-replay', SEAL, False),
            **{'baci-prefunded-' + kind: container_contract(kind, SEAL) for kind in ('snapshot', 'background')}}
        for value in self.values.values():
            value['State'] = {'Running': False}
        original = self.execute
        run = lambda args: 'ActiveState=inactive\nSubState=dead\n' if args[0] == '/usr/bin/systemctl' else original(args)
        self.assertTrue(runtime.financial_state('prestart', SEAL, SEAL, run)['financialContainersStopped'])
        self.values[runtime.REPLAY]['State']['Running'] = True
        with self.assertRaises(Exception):
            runtime.financial_state('prestart', SEAL, SEAL, run)
        self.assertFalse(runtime.financial_state('preschedule', SEAL, SEAL, run)['financialContainersStopped'])


if __name__ == '__main__':
    unittest.main()
