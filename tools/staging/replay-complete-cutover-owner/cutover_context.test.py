import base64
import hashlib
import hmac
import json
import unittest
from unittest.mock import Mock, patch

from cutover_context import Context, NONCLAIMANTS, verify_container_set, verify_financial_closure, verify_token


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')


def container(identifier, name, running=True, restart='unless-stopped'):
    return dict(Id=identifier, Name=name, State=dict(Running=running),
                HostConfig=dict(RestartPolicy=dict(Name=restart)),
                NetworkSettings=dict(Networks={'pvb-staging-receipts': {}}))


class ContextTests(unittest.TestCase):
    def test_reuses_authenticated_held_lock_without_opening_a_competing_descriptor(self):
        context = Context.__new__(Context)
        context.external_lock_guard = Mock(return_value=True)
        with patch('cutover_context.os.open') as opened:
            context.acquire_launch_lock()
        opened.assert_not_called()
        context.external_lock_guard.assert_called_once_with()

    def test_missing_false_or_truthy_external_lock_evidence_refuses_before_commands(self):
        for guard in (False, lambda: False, lambda: 1):
            context = Context.__new__(Context)
            context.external_lock_guard = guard
            with patch('cutover_context.os.open') as opened:
                with self.assertRaisesRegex(ValueError, 'external_launch_lock_required'):
                    context.acquire_launch_lock()
            opened.assert_not_called()

    def test_external_lock_loss_blocks_deadline_command(self):
        context = Context.__new__(Context)
        context.external_lock_guard = lambda: False
        context.owner = Mock()
        with self.assertRaisesRegex(ValueError, 'external_launch_lock_required'):
            context.deadline()
        context.owner.verify_deadline.assert_not_called()

    def test_existing_standalone_context_still_acquires_the_original_lock(self):
        context = Context.__new__(Context)
        context.external_lock_guard = None
        info = Mock(st_mode=0o100600, st_uid=0, st_nlink=1)
        with patch('cutover_context.os.open', return_value=42) as opened, \
                patch('cutover_context.os.fstat', return_value=info), \
                patch('cutover_context.fcntl.flock') as locked:
            context.acquire_launch_lock()
        self.assertEqual(context.lock, 42)
        self.assertEqual(opened.call_args.args[0], '/root/baci-complete-replay-cutover.lock')
        locked.assert_called_once()

    def test_original_closure_runs_in_a_clean_process_and_its_refusal_propagates(self):
        calls = []
        def run(arguments):
            calls.append(arguments)
            return '{"status":"sealed-financial-source-verified"}'
        verify_financial_closure(run)
        self.assertEqual(calls[0][:3], ['/usr/bin/python3', '-B', '-c'])
        self.assertIn("context['closure']()", calls[0][3])
        with self.assertRaisesRegex(RuntimeError, 'synthetic-original-refusal'):
            verify_financial_closure(lambda _: (_ for _ in ()).throw(RuntimeError('synthetic-original-refusal')))

    def test_cryptographic_signature_is_required_not_just_decoded_claims(self):
        secret = b'synthetic-test-only-key'
        claims = dict(role='pvb_staging_worker', aud='pvb-staging-receipts', iat=1, exp=2)
        unsigned = encode(dict(alg='HS256', typ='JWT')) + '.' + encode(claims)
        signature = base64.urlsafe_b64encode(hmac.digest(secret, unsigned.encode(), 'sha256')).decode().rstrip('=')
        token = unsigned + '.' + signature
        proof = verify_token(token, secret)
        self.assertEqual(proof['claims'], claims)
        self.assertEqual(proof['tokenSha256'], hashlib.sha256(token.encode()).hexdigest())
        with self.assertRaisesRegex(ValueError, 'receipt_token_refused'):
            verify_token(token, b'wrong-key')

    def test_unknown_running_receipt_network_container_refuses_exclusivity(self):
        values = [container(identifier, name) for identifier, name in NONCLAIMANTS.items()]
        self.assertTrue(verify_container_set(values))
        values.append(container('unknown-claimant', '/unknown'))
        with self.assertRaisesRegex(ValueError, 'additional_receipt_claimant_refused'):
            verify_container_set(values)

    def test_exact_allowed_claimant_requires_no_automatic_restart(self):
        values = [container(identifier, name) for identifier, name in NONCLAIMANTS.items()]
        values.append(container('candidate', '/pvb-staging-replay-prefunded', restart='no'))
        self.assertTrue(verify_container_set(values, 'candidate'))
        values[-1]['HostConfig']['RestartPolicy']['Name'] = 'always'
        with self.assertRaisesRegex(ValueError, 'additional_receipt_claimant_refused'):
            verify_container_set(values, 'candidate')

    def test_missing_or_renamed_physical_receipt_infrastructure_refuses(self):
        values = [container(identifier, name) for identifier, name in NONCLAIMANTS.items()]
        with self.assertRaisesRegex(ValueError, 'receipt_infrastructure_missing'):
            verify_container_set(values[:-1])
        values[0]['Name'] = '/renamed'
        with self.assertRaisesRegex(ValueError, 'receipt_infrastructure_identity_refused'):
            verify_container_set(values)


if __name__ == '__main__':
    unittest.main()
