import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import public_projection
import public_service_contract
from source_functions import DEADLINE, OLD_DEADLINE, _require

ARCHIVE = '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2'
MANIFEST = '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8'
LAUNCHER = 'd0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03'


def validate_mixed_public(activation, checkout, receipt, launcher, service, timer):
    _require(hashlib.sha256(activation).hexdigest() == public_projection.ACTIVATION_SHA256,
             'mixed_public_activation_predecessor_refused')
    expected = json.loads(public_projection.project_checkout(activation, 1790697549))
    for scope in (expected, expected['checkout']['scope'], expected['checkout']['provider']):
        _require(scope['expiresAt'] == OLD_DEADLINE, 'mixed_public_scope_predecessor_refused')
        scope['expiresAt'] = DEADLINE
    canonical = json.dumps(expected, sort_keys=True, separators=(',', ':')).encode()
    _require(checkout == canonical and checkout.count(DEADLINE.encode()) == 3,
             'mixed_public_checkout_refused')
    from activation_bundle import _json
    value = _json(receipt)
    _require(value.get('deadline') == DEADLINE and value.get('archiveSha256') == ARCHIVE
             and value.get('manifestSha256') == MANIFEST and value.get('mutationsEnabled') is False
             and value.get('checkoutSha256') == hashlib.sha256(checkout).hexdigest()
             and value.get('anonSha256') == '4763e070945b3ab7a954c12e8da7ed9d3cd79b44b30ef6843eb2da567126934e'
             and value.get('predecessorArchiveSha256') == '8f3babb4f2d6a9ecbbdc9d87c8209cbe45dbe6e124b7f059e1e391eeeb113134'
             and value.get('predecessorManifestSha256') == '7790f11a4a4254c5c79d5841e92fc927163f29ed06007466696e9fd4d91f8bf3',
             'mixed_public_receipt_refused')
    _require(hashlib.sha256(launcher).hexdigest() == LAUNCHER, 'mixed_public_launcher_refused')
    units = public_service_contract.units()
    expected_service = units['baci-prefunded-public.service'].replace('1790697550', '1791302350').encode()
    expected_timer = units['baci-prefunded-public-deadline.timer'].replace(
        '2026-09-29 15:59:10 UTC', '2026-10-06 15:59:10 UTC').encode()
    _require(service == expected_service and timer == expected_timer, 'mixed_public_units_refused')
