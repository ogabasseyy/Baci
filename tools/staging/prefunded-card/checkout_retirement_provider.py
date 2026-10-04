from datetime import datetime, timezone
import hmac
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

from checkout_retirement_contract import REFERENCE, digest
from public_projection import parsed, project_checkout
from public_service_contract import IMAGE, NAME, validate_container
from runtime_owner_support import DOCKER, command, inspect
from treasury_owner_contract import DEADLINE_EPOCH, Refused
from treasury_owner_io import read_file, root_ancestors


CONFIG = Path('/opt/baci-prefunded-public/config/checkout.json')
PREPARED = Path('/etc/baci/prefunded-card/activation.prepared.json')


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def active_configuration(manifest_sha):
    if time.time() >= DEADLINE_EPOCH:
        raise Refused('Existing checkout lease expired')
    observed = inspect(NAME)
    image = json.loads(command([*DOCKER, 'image', 'inspect', IMAGE]))
    if len(image) != 1 or image[0].get('Id') != IMAGE:
        raise Refused('Public checkout image differs')
    validate_container(observed, manifest_sha, image[0]['Config']['Env'])
    for path in (CONFIG, PREPARED):
        root_ancestors(path)
    actual = read_file(CONFIG, 0, 0o440, 131072)
    expected = project_checkout(read_file(PREPARED, 0, 0o600, 262144), time.time())
    mounted = command([*DOCKER, 'exec', '--user=65530:65530', NAME, '/usr/local/bin/node', '-e',
                       "process.stdout.write(require('node:fs').readFileSync('/run/pvb-public/checkout.json'))"])
    if not hmac.compare_digest(actual, expected) or not hmac.compare_digest(actual, mounted.encode()):
        raise Refused('Running checkout configuration differs')
    secret = parsed(actual)['checkout']['provider']['paystackSecret']
    if not isinstance(secret, str) or not re.fullmatch('sk_test_[A-Za-z0-9]+', secret):
        raise Refused('Test-only Paystack key required')
    return secret, digest(actual)


def classify_not_found(status, content):
    try:
        value = parsed(content)
        if (status != 400 or value.get('status') is not False or value.get('data') is not None
                or value.get('code') not in (None, 'transaction_not_found')
                or value.get('message') not in ('Transaction reference not found', 'Transaction reference not found.')):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise Refused('Provider did not confirm the expected unresolved reference') from None


def verify_unconfirmed(secret, configuration_sha, opener=None):
    if not re.fullmatch('sk_test_[A-Za-z0-9]+', secret) or not re.fullmatch('[a-f0-9]{64}', configuration_sha):
        raise Refused('Test verification input refused')
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
    request = urllib.request.Request('https://api.paystack.co/transaction/verify/' + REFERENCE,
        method='GET', headers={'Authorization': 'Bearer ' + secret, 'User-Agent': 'baci-checkout-retirement/1.0'})
    try:
        response = opener.open(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        content = response.read(32769)
        if len(content) > 32768:
            raise Refused('Provider verification response exceeded limit')
        classify_not_found(response.code, content)
    return dict(providerResult='transaction_not_found', providerHttp=400,
                verifiedAt=datetime.now(timezone.utc).isoformat(), configurationSha256=configuration_sha,
                operatorApproval='retire-unconfirmed-test-checkout-v1')
