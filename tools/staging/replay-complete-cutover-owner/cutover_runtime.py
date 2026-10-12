CONTAINER = 'pvb-staging-replay-prefunded'
NATIVE_ID = '5426aa344490d93dac4f6f777ef31a5ce49ec3f889a8e9cb1e99ae708a4ca111'
COMPETITOR_ID = 'c187f78aa0fd3676b08ef84e8e85192e4437943817b895ed2d5a65e3d884cbef'
NATIVE_ROOT = '/opt/baci-prefunded-replay-generations/native-m_xv_71j'
NATIVE_SEAL = '42966bb33ae5c84223cb56a4de17da442f8ce22c38f003fbcc447e39e0a85068'
CANDIDATE_ROOT = '/opt/baci-prefunded-replay-generations/complete-9r5r9u8z'
CANDIDATE_SEAL = '69585e50cb88aeac5e0660ed235b39f6ac6d675b35cf9acabd32cd2945d695ba'
RETAINED = CONTAINER + '-prior-' + NATIVE_ID[:12]
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']


def require(condition, code):
    if not condition:
        raise ValueError(code)


class CutoverRuntime:
    def __init__(self, operator, verify_files, inspect_competitor,
                 verify_exclusive, verify_prestart, journal):
        self.operator = operator
        self.verify_files = verify_files
        self.inspect_competitor = inspect_competitor
        self.verify_exclusive = verify_exclusive
        self.verify_prestart = verify_prestart
        self.journal = journal

    def _guard(self):
        require(self.verify_exclusive() is True, 'exclusive_launch_control_required')
        require(self.verify_files() is True, 'retained_candidate_files_required')
        self.operator.deadline()
        competitor = self.inspect_competitor()
        require(competitor['Id'] == COMPETITOR_ID
                and competitor['Name'] == '/baci-interest-replay'
                and competitor['State']['Running'] is False,
                'competing_claimant_must_stay_stopped')

    def _native(self, name=CONTAINER):
        value = self.operator.inspect(NATIVE_ID, NATIVE_ROOT, NATIVE_SEAL, name=name)
        require(value['State']['OOMKilled'] is False, 'native_oom_refused')
        return value

    def quiesce(self):
        self._guard()
        require(self.operator.find(CONTAINER) == NATIVE_ID, 'exact_native_identity_required')
        native = self._native()
        if native['State']['Running']:
            self.operator.run([*DOCKER, 'stop', '--time=45', NATIVE_ID], timeout=60)
        native = self._native()
        require(native['State']['Running'] is False and native['State']['ExitCode'] == 0,
                'native_graceful_stop_required')
        self._guard()
        self.journal('claimants-stopped', {'native': NATIVE_ID, 'competitor': COMPETITOR_ID})
        return {'stoppedClaimantIds': sorted([NATIVE_ID, COMPETITOR_ID])}

    def _stop_candidate(self, identifier):
        observed_id = self.operator.find(CONTAINER)
        if observed_id is None or observed_id == NATIVE_ID:
            return
        require(identifier is None or observed_id == identifier, 'candidate_identity_drift')
        observed = self.operator.inspect(observed_id, CANDIDATE_ROOT, CANDIDATE_SEAL,
                                         name=CONTAINER)
        if observed['State']['Running']:
            self.operator.run([*DOCKER, 'stop', '--time=45', observed_id], timeout=60)
        observed = self.operator.inspect(observed_id, CANDIDATE_ROOT, CANDIDATE_SEAL,
                                         name=CONTAINER)
        require(observed['State']['Running'] is False, 'candidate_stop_unconfirmed')
        self.journal('candidate-stopped', {'id': observed_id, 'predecessorRestarted': False})

    def start(self):
        candidate_id = None
        try:
            self._guard()
            require(self.verify_prestart() is True, 'fresh_committed_fence_prestart_required')
            require(self.operator.find(CONTAINER) == NATIVE_ID, 'exact_stopped_native_required')
            require(self._native()['State']['Running'] is False, 'native_must_be_stopped')
            require(self.operator.find(RETAINED) is None, 'retention_name_occupied')
            self.operator.run([*DOCKER, 'rename', NATIVE_ID, RETAINED])
            self.journal('predecessor-retained', {'id': NATIVE_ID, 'name': RETAINED})
            self._guard()
            require(self._native(RETAINED)['State']['Running'] is False,
                    'retained_native_must_stay_stopped')
            require(self.verify_prestart() is True, 'fresh_precreate_fence_required')
            candidate_id = self.operator.create(CANDIDATE_ROOT, CANDIDATE_SEAL, name=CONTAINER)
            self.journal('candidate-created', {'id': candidate_id, 'seal': CANDIDATE_SEAL})
            self._guard()
            require(self.verify_prestart() is True, 'fresh_prelaunch_fence_required')
            self.operator.start_bounded(candidate_id, CANDIDATE_ROOT, CANDIDATE_SEAL,
                                        name=CONTAINER)
            observed = self.operator.inspect(candidate_id, CANDIDATE_ROOT, CANDIDATE_SEAL,
                                              name=CONTAINER)
            require(observed['State']['Running'] is True, 'candidate_running_proof_required')
            self._guard()
            require(self._native(RETAINED)['State']['Running'] is False,
                    'retained_native_restart_refused')
            self.journal('candidate-running', {'id': candidate_id, 'seal': CANDIDATE_SEAL,
                                              'predecessorRestarted': False})
            return {'status': 'sealed-paired-replay-running', 'id': candidate_id,
                    'generationSealSha256': CANDIDATE_SEAL, 'receiptCreditProved': False}
        except Exception:
            try:
                self._stop_candidate(candidate_id)
            except Exception:
                raise ValueError('cutover_start_refused_candidate_stop_unconfirmed') from None
            raise ValueError('cutover_start_refused_no_predecessor_restart') from None
