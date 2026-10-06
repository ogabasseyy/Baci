import http.client
import json
import socket
import ssl
import subprocess
import unittest

from public_owner_diagnostic import public_owner_diagnostic
from treasury_owner_contract import Refused


class DiagnosticTests(unittest.TestCase):
    def test_static_preflight_refusals_have_exact_literal_codes(self):
        cases = (
            ('Root-private owner execution required', 'OWNER_ROOT_REQUIRED'),
            ('Unsafe owner entry point', 'OWNER_ENTRYPOINT_REFUSED'),
            ('Nginx activation requires private service startup', 'NGINX_START_REQUIRED'),
            ('Private directory metadata refused', 'PRIVATE_DIRECTORY_METADATA_REFUSED'),
            ('Root-owned ancestors required', 'ROOT_ANCESTORS_REFUSED'),
            ('Input file metadata refused', 'INPUT_FILE_METADATA_REFUSED'),
            ('Input file changed during read', 'INPUT_FILE_CHANGED'),
            ('Input file unavailable', 'INPUT_FILE_UNAVAILABLE'),
            ('Nginx installation requires root owner', 'NGINX_ROOT_REQUIRED'),
            ('Nginx approval expired', 'NGINX_APPROVAL_EXPIRED'),
            ('Nginx enabled site identity refused', 'NGINX_ENABLED_SITE_IDENTITY_REFUSED'),
            ('Nginx file identity changed', 'NGINX_FILE_IDENTITY_CHANGED'),
            ('Nginx pinned site unavailable', 'NGINX_PINNED_SITE_UNAVAILABLE'),
            ('Nginx predecessor changed during preparation', 'NGINX_PREDECESSOR_CHANGED'),
            ('Repeated Nginx installation refused', 'NGINX_REPEATED_INSTALLATION_REFUSED'),
            ('Nginx observed predecessor size changed', 'NGINX_PREDECESSOR_SIZE_CHANGED'),
            ('Nginx token shape refused', 'NGINX_TOKEN_SHAPE_REFUSED'),
            ('Nginx requires exactly one server block', 'NGINX_SERVER_BLOCK_COUNT_REFUSED'),
            ('Nginx unnamed block refused', 'NGINX_UNNAMED_BLOCK_REFUSED'),
            ('Nginx top-level scope refused', 'NGINX_TOP_LEVEL_SCOPE_REFUSED'),
            ('Nginx nested server refused', 'NGINX_NESTED_SERVER_REFUSED'),
            ('Nginx location scope refused', 'NGINX_LOCATION_SCOPE_REFUSED'),
            ('Nginx shared, wildcard or duplicate location refused', 'NGINX_LOCATION_CONFLICT'),
            ('Nginx fallback must stay disabled', 'NGINX_FALLBACK_NOT_DISABLED'),
            ('Nginx block shape refused', 'NGINX_BLOCK_SHAPE_REFUSED'),
            ('Nginx named gateway fallback differs', 'NGINX_NAMED_FALLBACK_MISMATCH'),
            ('Nginx managed gateway root differs', 'NGINX_MANAGED_GATEWAY_ROOT_MISMATCH'),
            ('Nginx directive scope refused', 'NGINX_DIRECTIVE_SCOPE_REFUSED'),
            ('Nginx server identity refused', 'NGINX_SERVER_IDENTITY_REFUSED'),
            ('Existing public checkout route refused', 'NGINX_CHECKOUT_ALREADY_PRESENT'),
            ('Nginx single-server shape refused', 'NGINX_SINGLE_SERVER_SHAPE_REFUSED'),
            ('Nginx input or reviewed pin refused', 'NGINX_INPUT_OR_PIN_REFUSED'),
            ('Nginx predecessor digest changed', 'NGINX_PREDECESSOR_DIGEST_CHANGED'),
            ('Public HTTP staging deadline expired', 'HTTP_DEADLINE_EXPIRED'),
            ('Public HTTP response exceeds limit', 'HTTP_RESPONSE_TOO_LARGE'),
            ('Public HTTP status differs', 'HTTP_STATUS_MISMATCH'),
            ('Public HTTP JSON contract differs', 'HTTP_JSON_CONTRACT_MISMATCH'),
        )
        for message, code in cases:
            with self.subTest(code=code):
                self.assertEqual(public_owner_diagnostic(Refused(message)), {
                    'reasonCode': code, 'exceptionClass': 'Refused',
                })

    def test_unknown_secret_and_partial_known_messages_use_only_the_fixed_fallback(self):
        secret = 'synthetic-secret-never-output'
        known = 'Nginx token shape refused'
        for message in (secret, known + ': ' + secret, secret + known, known + '\n', known.lower()):
            with self.subTest(message=message):
                result = public_owner_diagnostic(Refused(message))
                self.assertEqual(result, {
                    'reasonCode': 'UNCLASSIFIED_REFUSAL', 'exceptionClass': 'Refused',
                })
                self.assertNotIn(secret, json.dumps(result))

    def test_known_text_in_another_exception_cannot_claim_a_refusal_code(self):
        self.assertEqual(public_owner_diagnostic(RuntimeError('Nginx token shape refused')), {
            'reasonCode': 'UNEXPECTED_EXCEPTION', 'exceptionClass': 'RuntimeError',
        })

    def test_exception_class_codes_never_include_network_or_subprocess_details(self):
        secret = 'https://user:synthetic-network-secret@private.invalid/path'
        errors = (
            (OSError(secret), 'OSError'),
            (TimeoutError(secret), 'TimeoutError'),
            (ConnectionRefusedError(secret), 'ConnectionRefusedError'),
            (ConnectionResetError(secret), 'ConnectionResetError'),
            (FileNotFoundError(secret), 'FileNotFoundError'),
            (PermissionError(secret), 'PermissionError'),
            (BlockingIOError(secret), 'BlockingIOError'),
            (InterruptedError(secret), 'InterruptedError'),
            (socket.gaierror(-2, secret), 'gaierror'),
            (ssl.SSLError(1, secret), 'SSLError'),
            (ssl.SSLCertVerificationError(1, secret), 'SSLCertVerificationError'),
            (http.client.HTTPException(secret), 'HTTPException'),
            (http.client.RemoteDisconnected(secret), 'RemoteDisconnected'),
            (subprocess.TimeoutExpired([secret], 1, output=secret, stderr=secret), 'TimeoutExpired'),
            (subprocess.CalledProcessError(1, [secret], output=secret, stderr=secret), 'CalledProcessError'),
            (UnicodeDecodeError('utf8', secret.encode(), 0, 1, secret), 'UnicodeDecodeError'),
            (ValueError(secret), 'ValueError'),
            (TypeError(secret), 'TypeError'),
            (RuntimeError(secret), 'RuntimeError'),
        )
        for error, category in errors:
            with self.subTest(category=category):
                result = public_owner_diagnostic(error)
                self.assertEqual(result, {
                    'reasonCode': 'UNEXPECTED_EXCEPTION', 'exceptionClass': category,
                })
                self.assertNotIn('synthetic-network-secret', json.dumps(result))
                self.assertNotIn('private.invalid', json.dumps(result))

    def test_unknown_class_names_and_stringification_are_never_used(self):
        class Unprintable:
            def __str__(self):
                raise AssertionError('Diagnostic must not stringify arbitrary values')

        class RefusedSubclass(Refused):
            def __str__(self):
                raise AssertionError('Diagnostic must not stringify exceptions')

        class TextSubclass(str):
            pass

        unknown = type('SecretExceptionName', (Exception,), {})
        for error in (unknown('secret'), RefusedSubclass('Nginx token shape refused')):
            self.assertEqual(public_owner_diagnostic(error), {
                'reasonCode': 'UNEXPECTED_EXCEPTION', 'exceptionClass': 'Exception',
            })
        for error in (Refused(), Refused(Unprintable()), Refused('Nginx token shape refused', 'secret'),
                      Refused(TextSubclass('Nginx token shape refused'))):
            self.assertEqual(public_owner_diagnostic(error), {
                'reasonCode': 'UNCLASSIFIED_REFUSAL', 'exceptionClass': 'Refused',
            })

    def test_known_refusal_does_not_include_its_sensitive_cause_or_context(self):
        error = Refused('Nginx token shape refused')
        error.__cause__ = RuntimeError('synthetic-cause-secret')
        error.__context__ = RuntimeError('synthetic-context-secret')

        self.assertEqual(public_owner_diagnostic(error), {
            'reasonCode': 'NGINX_TOKEN_SHAPE_REFUSED', 'exceptionClass': 'Refused',
        })


if __name__ == '__main__':
    unittest.main()
