import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name('cutover_probes.py')


class CutoverProbeTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SOURCE.is_file(), 'Pure probe implementation is missing')
        specification = importlib.util.spec_from_file_location('cutover_probe_tests', SOURCE)
        self.module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.module)
        self.tokens = dict(oldNative='synthetic-native-private-token',
                           oldInterest='synthetic-interest-private-token',
                           new='synthetic-new-private-token')
        self.proofs = {}
        for name, token in self.tokens.items():
            claims = dict(role='pvb_staging_worker', aud='pvb-staging-receipts',
                          iat=1791000000, exp=1791302350)
            if name == 'new':
                claims['replay_claimant_generation'] = '1a420a7b-0c17-4312-84dc-d276a32f19f4'
            self.proofs[name] = dict(signatureVerified=True, claims=claims,
                                    tokenSha256=hashlib.sha256(token.encode()).hexdigest())
        self.identity = dict(verified=True, systemIdentifier='7686901100561231906')
        self.state = dict(receiptStateSha256='1' * 64, quarantineStateSha256='2' * 64,
                          signatureStateSha256='3' * 64, financialStateSha256='4' * 64,
                          principalStateSha256='5' * 64)
        self.calls = []
        self.snapshots = []
        self.responses = [self.response(403, '42501', 'Replay claimant refused'),
                          self.response(403, '42501', 'Replay claimant refused'),
                          self.response(400, '22023', 'Invalid claim bounds')]

    def response(self, status, code, message):
        return dict(status=status, body=json.dumps(dict(code=code, message=message,
                                                       details=None, hint=None)).encode())

    def request(self, **arguments):
        self.calls.append(copy.deepcopy(arguments))
        return self.responses[len(self.calls) - 1]

    def snapshot(self):
        self.snapshots.append(True)
        return self.state

    def run_probes(self, request=None, snapshot=None):
        return self.module.probe_claim_fence(tokens=self.tokens, token_proofs=self.proofs,
            physical_identity=self.identity, request=request or self.request,
            snapshot=snapshot or self.snapshot)

    def test_both_old_credentials_refuse_and_new_reaches_only_null_bounds_validation(self):
        result = self.run_probes()

        self.assertEqual(result, dict(status='claim-fence-probes-passed',
            receiptSystemId='7686901100561231906', protectedSnapshotsUnchanged=True,
            probes=[dict(credential='oldNative', httpStatus=403, postgresCode='42501'),
                    dict(credential='oldInterest', httpStatus=403, postgresCode='42501'),
                    dict(credential='new', httpStatus=400, postgresCode='22023')]))
        self.assertEqual(self.calls, [dict(token=self.tokens[name], method='POST',
            path='/rpc/claim_piggyvest_staging_receipts',
            payload=dict(p_limit=None, p_lease_seconds=None))
            for name in ('oldNative', 'oldInterest', 'new')])
        self.assertEqual(len(self.snapshots), 2)
        for token in self.tokens.values():
            self.assertNotIn(token, json.dumps(result))

    def test_identical_old_tokens_still_receive_two_separate_probes(self):
        self.tokens['oldInterest'] = self.tokens['oldNative']
        self.proofs['oldInterest'] = copy.deepcopy(self.proofs['oldNative'])

        self.run_probes()

        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[0]['token'], self.calls[1]['token'])

    def test_unverified_or_wrong_physical_database_refuses_before_callbacks(self):
        for identity in (dict(verified=False, systemIdentifier='7686901100561231906'),
                         dict(verified=1, systemIdentifier='7686901100561231906'),
                         dict(verified=True, systemIdentifier='7685292944002592802'), {}):
            with self.subTest(identity=identity):
                self.identity = identity
                with self.assertRaisesRegex(ValueError, '^claim_fence_probe_refused$'):
                    self.run_probes()
                self.assertEqual(self.calls, [])
                self.assertEqual(self.snapshots, [])

    def test_wrong_signed_role_audience_generation_or_expiry_refuses_before_callbacks(self):
        original = copy.deepcopy(self.proofs)
        cases = [('role', 'authenticated'), ('aud', 'pvb staging-receipts'),
                 ('aud', ['pvb-staging-receipts']), ('exp', 1791302351),
                 ('exp', '1791302350'), ('exp', True), ('iat', True),
                 ('replay_claimant_generation', None),
                 ('replay_claimant_generation', '40000000-0000-4000-8000-000000000002')]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                self.proofs = copy.deepcopy(original)
                self.proofs['new']['claims'][field] = value
                with self.assertRaises(ValueError):
                    self.run_probes()
                self.assertEqual(self.calls, [])
                self.assertEqual(self.snapshots, [])

    def test_each_token_requires_signature_verification_and_exact_token_hash(self):
        original = copy.deepcopy(self.proofs)
        for name in ('oldNative', 'oldInterest', 'new'):
            for field, value in (('signatureVerified', False), ('signatureVerified', 1),
                                 ('tokenSha256', '0' * 64)):
                with self.subTest(name=name, field=field):
                    self.proofs = copy.deepcopy(original)
                    self.proofs[name][field] = value
                    with self.assertRaises(ValueError):
                        self.run_probes()
                    self.assertEqual(self.calls, [])

    def test_old_generation_claim_or_new_reused_old_token_refuses(self):
        self.proofs['oldInterest']['claims']['replay_claimant_generation'] = 'unexpected'
        with self.assertRaises(ValueError):
            self.run_probes()
        self.proofs['oldInterest']['claims'].pop('replay_claimant_generation')
        self.tokens['new'] = self.tokens['oldNative']
        self.proofs['new']['tokenSha256'] = self.proofs['oldNative']['tokenSha256']
        with self.assertRaises(ValueError):
            self.run_probes()
        self.assertEqual(self.calls, [])

    def test_missing_either_old_credential_or_any_proof_refuses_before_callbacks(self):
        tokens, proofs = dict(self.tokens), copy.deepcopy(self.proofs)
        for name in ('oldNative', 'oldInterest', 'new'):
            for field in ('tokens', 'proofs'):
                with self.subTest(name=name, field=field):
                    self.tokens, self.proofs = dict(tokens), copy.deepcopy(proofs)
                    (self.tokens if field == 'tokens' else self.proofs).pop(name)
                    with self.assertRaises(ValueError):
                        self.run_probes()
                    self.assertEqual(self.calls, [])
                    self.assertEqual(self.snapshots, [])

    def test_empty_nonstring_or_header_control_token_refuses_before_callbacks(self):
        for token in ('', None, 'synthetic\r\nprivate', ' padded ', '\u00e9', 'a' * 8193):
            with self.subTest(token_type=type(token).__name__):
                self.tokens['oldInterest'] = token
                with self.assertRaisesRegex(ValueError, '^claim_fence_probe_refused$'):
                    self.run_probes()
                self.assertEqual(self.calls, [])

    def test_wrong_status_code_message_or_legacy_interest_acceptance_refuses(self):
        cases = [(0, self.response(401, '42501', 'Replay claimant refused')),
                 (0, self.response(403, '42501', 'incorrect')),
                 (1, self.response(400, '22023', 'Invalid claim bounds')),
                 (2, self.response(403, '42501', 'Replay claimant refused')),
                 (2, self.response(400, '22023', 'incorrect')),
                 (2, self.response(200, '22023', 'Invalid claim bounds'))]
        original = copy.deepcopy(self.responses)
        for index, response in cases:
            with self.subTest(index=index, status=response['status']):
                self.calls.clear()
                self.snapshots.clear()
                self.responses = copy.deepcopy(original)
                self.responses[index] = response
                with self.assertRaises(ValueError):
                    self.run_probes()
                self.assertEqual(len(self.snapshots), 2)

    def test_malformed_duplicate_or_unexpected_response_fields_refuse(self):
        bodies = [b'not-json', b'\xff', b'[]', b'null', b'{}',
                  b'{"code":"42501","code":"42501","message":"Replay claimant refused","details":null,"hint":null}',
                  json.dumps(dict(code='42501', message='Replay claimant refused',
                                  details='unexpected', hint=None)).encode(),
                  json.dumps(dict(code='42501', message='Replay claimant refused',
                                  details=None, hint=None, secret='private')).encode()]
        for body in bodies:
            with self.subTest(body=body):
                self.calls.clear()
                self.responses[0] = dict(status=403, body=body)
                with self.assertRaises(ValueError):
                    self.run_probes()

    def test_raw_utf8_text_response_is_accepted_without_coercing_status(self):
        self.responses = [dict(status=value['status'], body=value['body'].decode())
                          for value in self.responses]
        self.run_probes()
        self.calls.clear()
        self.responses[0]['status'] = '403'
        with self.assertRaises(ValueError):
            self.run_probes()

    def test_changed_shared_snapshot_is_detected_for_each_protected_category(self):
        original = dict(self.state)
        for field in original:
            with self.subTest(field=field):
                self.calls.clear()
                self.state = dict(original)
                def mutate(**arguments):
                    response = self.request(**arguments)
                    if len(self.calls) == 3:
                        self.state[field] = '0' * 64
                    return response
                with self.assertRaises(ValueError):
                    self.run_probes(request=mutate)

    def test_incomplete_snapshot_refuses_before_any_http(self):
        self.state.pop('signatureStateSha256')
        with self.assertRaises(ValueError):
            self.run_probes()
        self.assertEqual(self.calls, [])

    def test_nonhash_snapshot_values_refuse_before_any_http(self):
        for value in (None, True, 'G' * 64, '1' * 63):
            with self.subTest(value_type=type(value).__name__):
                self.state['financialStateSha256'] = value
                with self.assertRaises(ValueError):
                    self.run_probes()
                self.assertEqual(self.calls, [])

    def test_after_snapshot_failure_never_returns_partial_probe_success(self):
        def fail_after():
            if self.snapshots:
                raise RuntimeError(self.tokens['new'])
            return self.snapshot()
        with self.assertRaises(ValueError) as caught:
            self.run_probes(snapshot=fail_after)
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(str(caught.exception), 'claim_fence_probe_refused')
        self.assertIsNone(caught.exception.__context__)

    def test_callback_exception_is_redacted_and_still_checks_after_snapshot(self):
        def fail(**arguments):
            raise RuntimeError(self.tokens['new'])
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with self.assertRaises(ValueError) as caught:
                self.run_probes(request=fail)
        self.assertEqual(str(caught.exception), 'claim_fence_probe_refused')
        self.assertIsNone(caught.exception.__context__)
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), '')
        self.assertEqual(len(self.snapshots), 2)

    def test_snapshot_exception_is_redacted_without_http(self):
        def fail():
            raise RuntimeError(self.tokens['new'])
        with self.assertRaises(ValueError) as caught:
            self.run_probes(snapshot=fail)
        self.assertEqual(str(caught.exception), 'claim_fence_probe_refused')
        self.assertIsNone(caught.exception.__context__)
        self.assertEqual(self.calls, [])

    def test_each_http_callback_receives_fresh_null_only_bounds(self):
        def mutate(**arguments):
            response = self.request(**arguments)
            arguments['payload']['p_limit'] = 10
            return response
        self.run_probes(request=mutate)
        self.assertTrue(all(call['payload'] == dict(p_limit=None, p_lease_seconds=None)
                            for call in self.calls))

    def test_guards_remain_active_with_python_optimization(self):
        namespace = {}
        exec(compile(SOURCE.read_text(), str(SOURCE), 'exec', optimize=2), namespace)
        self.module.probe_claim_fence = namespace['probe_claim_fence']
        self.identity['verified'] = False
        with self.assertRaises(ValueError):
            self.run_probes()
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
