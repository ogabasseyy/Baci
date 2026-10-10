#!/usr/bin/env python3
"""Owner-run activation for the fixed-deadline hosted-funding route transition.

Completes the ceremony started by funding-gateway-transition-candidate.py:
re-validates the owner-blessed pins, swaps the gateway binding from the exact
pre-transition five routes to the exact eleven-route contract, refreshes
startup evidence, restarts the gateway, and verifies old, new, and passthrough
behavior. Any failure after installation rolls the binding back.

Modes:
  --check          Validate everything, build the new evidence in memory, and
                   report readiness. No writes, no restart.
  --activate       Run the full ceremony including install, restart, verify,
                   and the transition provenance receipt.
  --build-package  Materialize the sealed transition package (new binding,
                   package manifest, owner inputs, post-renewal manifest)
                   from the live binding and renewal state into
                   ./funding-transition-package/ and print its pins.
"""

import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path


CANDIDATE_PATH = Path(__file__).with_name(
    'funding-gateway-transition-candidate.py'
)
CONFIG_DIRECTORY = Path('/etc/baci-savings-gateway')
STATE_DIRECTORY = Path('/var/lib/baci-savings-gateway-install')
PROVENANCE_NAME = 'funding-transition-receipt.json'
LOCK_PATH = Path('/run/funding-gateway-transition.lock')
PACKAGE_DIRECTORY_NAME = 'funding-transition-package'
BINDING_PATH = CONFIG_DIRECTORY / 'binding.json'
EVIDENCE_PATH = CONFIG_DIRECTORY / 'startup-evidence.json'
PACKAGE_BINDING_PATH = CONFIG_DIRECTORY / 'funding-transition-binding.json'
GATEWAY_SERVICE = 'baci-savings-gateway.service'
DRAFTS_SERVICE = 'baci-savings-drafts.service'
SOCKET_PATH = '/run/baci-savings-gateway/ingress.sock'
RUNTIME_DIRECTORY = '/run/baci-savings-gateway'
GATEWAY_CODE = '/opt/baci-savings-gateway'
DEADLINE_EPOCH = 1790697550
EVIDENCE_FRESHNESS_MS = 5000
RECEIPT_FRESHNESS_MS = 300000
GATEWAY_ACCOUNT = 'baci-savings-gateway'
STAGING_HOST = 'staging-auth.ogabassey.com'

CURRENT_ROUTES = (
    ('/rest/v1/products', ('GET', 'HEAD')),
    ('/rest/v1/customers', ('GET', 'HEAD')),
    ('/rest/v1/merchants', ('GET', 'HEAD')),
    ('/rest/v1/rpc/customer_savings_draft_command', ('POST',)),
    ('/rest/v1/rpc/get_storefront_product_variants', ('POST',)),
)

# sha256 over the canonical JSON of the exact eleven-route contract. The
# activator recomputes it from the imported candidate module at runtime and
# refuses on mismatch, so a tampered or drifted candidate cannot widen the
# installed routes. Recompute when the reviewed contract changes.
EXPECTED_ROUTES_SHA256 = (
    'd494efc3d540bccc09970607220ec8c0d57263c7c282f3fe46e33e77f9bbbcfe'
)


# Pinned fragment composition: the ceremony below was split out of this file
# (AGENTS.md 300-line limit) into focused fragments executed here into this
# same namespace, so every attribute and patch target keeps working and
# tracebacks keep real filenames via compile(). Each fragment is
# hash-verified before execution; the entry itself is pinned by
# tools/staging/savings-engagement/gateway.py, completing the chain.
ACTIVATOR_FRAGMENT_SHA256 = {
    'funding-gateway-transition-activator-shared.py': 'ddee0a317bfe08e055313e2448c05a43b57c10b915979c6eede6ce53927d9d67',
    'funding-gateway-transition-activator-package.py': '82e552acaaab7f85f4a983215530ff1b956eea15beb38455e528751b2cd8a485',
    'funding-gateway-transition-activator-preflight.py': '0520285e067f4724fd949dd5acd11a15fdf7485f0d28b8835912698f8ebe17fd',
    'funding-gateway-transition-activator-install.py': 'd6201e31e90199e83dc3659eec008b751f1968d4a3eb020fe61db445b016da3c',
}


class Refused(RuntimeError):
    pass


class RolledBack(RuntimeError):
    pass


def _fragment_bytes(name: str, path: Path | None = None) -> tuple[bytes, str]:
    try:
        expected = ACTIVATOR_FRAGMENT_SHA256[name]
    except KeyError:
        raise Refused(f'Transition fragment is not pinned: {name}') from None
    target = Path(__file__).with_name(name) if path is None else path
    try:
        content = target.read_bytes()
    except OSError as error:
        raise Refused(f'Transition fragment is unavailable: {name}') from error
    if hashlib.sha256(content).hexdigest() != expected:
        raise Refused(f'Transition fragment failed verification: {name}')
    return content, str(target)


def _load_fragment(name: str) -> None:
    content, filename = _fragment_bytes(name)
    exec(compile(content, filename, 'exec'), globals())  # noqa: S102 - pinned bytes only, see above


for _fragment_name in ACTIVATOR_FRAGMENT_SHA256:
    _load_fragment(_fragment_name)
del _fragment_name


def _prepare() -> dict:
    candidate = _load_pinned_candidate()
    preflight = candidate.validate_preflight()
    current_binding, current_bytes = _read_json(BINDING_PATH, 0, (0o440,))
    identity = validate_current_binding(current_binding)
    packaged, binding_bytes = _validate_package(
        candidate, current_binding, preflight
    )
    gateway = _service_state(GATEWAY_SERVICE)
    drafts = _service_state(DRAFTS_SERVICE)
    if (
        gateway['ActiveState'] != 'active'
        or not gateway['MainPID'].isdigit()
        or drafts['ActiveState'] != 'active'
    ):
        raise Refused('Transition service state rejected.')
    _firewall_preflight()
    _reachability_preflight(identity)
    baseline = _probe_baseline()
    inventory, started_ms = _collect_inventory()
    evidence, evidence_bytes = _build_evidence(packaged, inventory, started_ms)
    _validate_evidence(packaged, evidence, started_ms, int(time.time() * 1000))
    uid, gid = _gateway_account()
    _verify_socket(uid, gid)
    _, evidence_current = _read_json(EVIDENCE_PATH, 0, (0o440,))
    return {
        'candidate': candidate,
        'preflight': preflight,
        'current_bytes': current_bytes,
        'packaged': packaged,
        'binding_bytes': binding_bytes,
        'evidence': evidence,
        'evidence_bytes': evidence_bytes,
        'evidence_current': evidence_current,
        'baseline': baseline,
        'uid': uid,
        'gid': gid,
        'previous_invocation': gateway['InvocationID'],
    }


def check() -> dict[str, object]:
    context = _prepare()
    packaged = context['packaged']
    return {
        'status': 'ready',
        'routesBefore': len(CURRENT_ROUTES),
        'routesAfter': len(context['candidate'].ROUTES),
        'leaseExpiresAt': packaged['leaseExpiresAt'],
        'bindingSha256': _sha(context['binding_bytes']),
        'evidenceSha256': _sha(context['evidence_bytes']),
        'baselineProbes': len(context['baseline']),
    }


def _restart_gateway() -> None:
    _run(['/usr/bin/systemctl', 'restart', GATEWAY_SERVICE], timeout=30)


def activate() -> dict[str, object]:
    context = _prepare()
    candidate = context['candidate']
    workdir = Path(
        tempfile.mkdtemp(prefix='baci-gateway-transition-', dir='/root')
    )
    keep_workdir = False
    try:
        (workdir / 'binding.json').write_bytes(context['current_bytes'])
        os.chmod(workdir / 'binding.json', 0o400)
        (workdir / 'startup-evidence.json').write_bytes(context['evidence_current'])
        os.chmod(workdir / 'startup-evidence.json', 0o400)
        try:
            _install_managed(BINDING_PATH, context['binding_bytes'], context['gid'])
            _install_managed(EVIDENCE_PATH, context['evidence_bytes'], context['gid'])
            _restart_gateway()
            _poll_gateway(
                context['previous_invocation'], context['uid'], context['gid']
            )
            _verify_post_transition(context['baseline'])
            drafts = _service_state(DRAFTS_SERVICE)
            if drafts['ActiveState'] != 'active':
                raise Refused('Drafts service did not stay active.')
            activation = {
                'activatedAt': datetime.now(tz=UTC)
                .isoformat(timespec='milliseconds')
                .replace('+00:00', 'Z'),
                'host': context['packaged']['identity']['host'],
                'leaseExpiresAt': context['packaged']['leaseExpiresAt'],
                'previousBindingSha256': _sha(context['current_bytes']),
                'bindingSha256': _sha(context['binding_bytes']),
                'startupEvidenceSha256': _sha(context['evidence_bytes']),
                'routesBefore': len(CURRENT_ROUTES),
                'routesAfter': len(candidate.ROUTES),
            }
            provenance = _write_provenance(
                candidate,
                context['preflight'],
                activation,
                getattr(candidate, 'STATE_DIRECTORY', STATE_DIRECTORY),
            )
        except Refused as error:
            try:
                _rollback(context, workdir, error)
            except Refused:
                keep_workdir = True
                raise
            raise AssertionError('unreachable')
        return {
            'status': 'activated',
            'provenanceSha256': _sha(provenance),
            'bindingSha256': _sha(context['binding_bytes']),
            'routesAfter': len(candidate.ROUTES),
        }
    finally:
        if not keep_workdir:
            shutil.rmtree(workdir, ignore_errors=True)


def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--activate', action='store_true')
    modes.add_argument('--build-package', action='store_true')
    parsed = parser.parse_args(arguments)
    try:
        if os.geteuid() != 0:
            raise Refused('Owner-reviewed root execution is required.')
        verify_graph()
        with _locked():
            if parsed.build_package:
                print(_compact(build_package()).decode())
            elif parsed.check:
                print(_compact(check()).decode())
            else:
                print(_compact(activate()).decode())
    except RolledBack as error:
        print(f'Funding gateway transition rolled back; {error}', file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 - ceremony must report, never trace
        print(f'Funding gateway transition refused; {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
