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

# Must match funding-gateway-recovery-runner.mjs graph byte for byte; the
# cross-file test enforces it mechanically. Per-file mode overrides below
# mirror the original installation contracts exactly: only the executable
# inventory helper carries 0550, and only that path accepts it.
GRAPH_DEFAULT_MODES = (0o400, 0o440, 0o444, 0o600, 0o644)
GRAPH_MODE_OVERRIDES = {
    f'{GATEWAY_CODE}/managed-inventory-helper.mjs': (0o550,),
}
GRAPH = {
    '/etc/systemd/system/baci-savings-gateway.service': '8539934f7d9a499e93158388843097cda7c31a398c22df4d8e9a0400170a0bf3',
    f'{GATEWAY_CODE}/compose.mjs': '7e34a257b21c9527d97aaac4ffc3957225b55d3be6e08455bd7b272eba5575dd',
    f'{GATEWAY_CODE}/managed-files.mjs': 'd9d0c6cbfeddbf6ecd249dd9760d8cd09f38880fdcbefc7a0cdbd79e1553b061',
    f'{GATEWAY_CODE}/managed-gateway-cli.mjs': '314f63daa895429a5ba4134e2b748edcc5f0c41965a3b6740ce102fd69162866',
    f'{GATEWAY_CODE}/managed-gateway.mjs': '94f3d2ecbf6b1adc437b84c75afc6b8a921b19d212dcfe34f8625e84bae50825',
    f'{GATEWAY_CODE}/managed-inventory-helper.mjs': 'e78e34607bab7b5eac71878527081f808199e89f999d46c638b5ac298529a80d',
    f'{GATEWAY_CODE}/private-routing-inventory.mjs': 'f8feff6a3b48645f0ae44d25cf1ab18952e0c11510a2aeac2f6f6cd898c4ddbd',
    f'{GATEWAY_CODE}/private-routing-supervisor-child.py': '6dfdedd0d182d8b836c7a67b30d50c7049e6f7b5272ceb7ba4da507b2723b16d',
    f'{GATEWAY_CODE}/private-routing-supervisor-inventory.mjs': '6205de16870dfb1e5219df2cafc2fdd6252505d0f3349a1064e0ffe8b49f7781',
    f'{GATEWAY_CODE}/private-routing.mjs': '8aa326f61e6de815a8cd6a16aca1fbae92eb8db925e0d65dc4b25a93c32a0617',
}

NODE_IDENTITY_PROGRAM = (
    "import { readFileSync } from 'node:fs';\n"
    "const { validateRoutingIdentity } = await import("
    f"'{GATEWAY_CODE}/private-routing-inventory.mjs');\n"
    "const { receipt, inventory } = JSON.parse(readFileSync(0, 'utf8'));\n"
    "validateRoutingIdentity(receipt, inventory);\n"
)

NODE_STARTUP_PROGRAM = (
    "import { readFileSync } from 'node:fs';\n"
    "const { validateManagedStartup } = await import("
    f"'{GATEWAY_CODE}/managed-gateway.mjs');\n"
    "const { binding, evidence, now } = JSON.parse(readFileSync(0, 'utf8'));\n"
    "validateManagedStartup(binding, evidence, now);\n"
)


class Refused(RuntimeError):
    pass


class RolledBack(RuntimeError):
    pass


def _load_candidate():
    spec = importlib.util.spec_from_file_location(
        'funding_gateway_transition_candidate', CANDIDATE_PATH
    )
    if spec is None or spec.loader is None:
        raise Refused('Transition candidate module is unavailable.')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_ancestors(path: Path, owner_uid: int) -> None:
    for ancestor in reversed((path.parent, *path.parent.parents)):
        try:
            metadata = ancestor.lstat()
        except OSError as error:
            raise Refused('Root-managed path is unavailable.') from error
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != owner_uid
            or metadata.st_mode & 0o022
        ):
            raise Refused('Root-managed path is unsafe.')


def _read_root_file(
    path: Path, owner_uid: int = 0, modes: tuple[int, ...] = (0o400, 0o600)
) -> bytes:
    _safe_ancestors(path, owner_uid)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise Refused('Root-managed input is unavailable.') from error
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) not in modes
            or before.st_size > 1_048_576
        ):
            raise Refused('Root-managed input is unsafe.')
        content = handle.read()
        after = os.fstat(handle.fileno())
    if (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
        before.st_ctime_ns,
    ) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    ):
        raise Refused('Root-managed input changed while read.')
    return content


def _read_json(path: Path, owner_uid: int, modes: tuple[int, ...]) -> tuple[dict, bytes]:
    content = _read_root_file(path, owner_uid, modes)
    try:
        value = json.loads(content)
    except (TypeError, ValueError) as error:
        raise Refused('Root-managed input is not valid JSON.') from error
    if not isinstance(value, dict):
        raise Refused('Root-managed input has an invalid shape.')
    return value, content


def _run(
    arguments: list[str], timeout: int = 10, payload: bytes | None = None
) -> str:
    try:
        completed = subprocess.run(
            arguments,
            input=payload,
            capture_output=True,
            timeout=timeout,
            env={'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise Refused('Managed command failed.') from error
    if completed.returncode != 0:
        raise Refused('Managed command failed.')
    if len(completed.stdout) > 1_048_576:
        raise Refused('Managed command output is too large.')
    try:
        return completed.stdout.decode('utf-8')
    except ValueError as error:
        raise Refused('Managed command output is invalid.') from error


def verify_graph() -> None:
    for path, expected in GRAPH.items():
        target = Path(path)
        modes = GRAPH_MODE_OVERRIDES.get(path, GRAPH_DEFAULT_MODES)
        _safe_ancestors(target, 0)
        digest = _sha(_read_root_file(target, 0, modes))
        if digest != expected:
            raise Refused('Pinned gateway graph rejected.')


def _routes_tuple(value: object) -> tuple:
    if not isinstance(value, list):
        raise Refused('Binding routes are invalid.')
    parsed = []
    for route in value:
        if not isinstance(route, dict) or set(route) != {'path', 'methods'}:
            raise Refused('Binding routes are invalid.')
        path, methods = route['path'], route['methods']
        if (
            not isinstance(path, str)
            or not isinstance(methods, list)
            or not methods
            or not all(isinstance(method, str) for method in methods)
        ):
            raise Refused('Binding routes are invalid.')
        parsed.append((path, tuple(methods)))
    return tuple(parsed)


def _lease_moment(value: object, expected_epoch: int | None) -> int:
    if not isinstance(value, str):
        raise Refused('Binding lease is invalid.')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise Refused('Binding lease is invalid.') from error
    if parsed.tzinfo is None:
        raise Refused('Binding lease is invalid.')
    if parsed.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z') != value:
        raise Refused('Binding lease is invalid.')
    epoch = int(parsed.timestamp())
    if expected_epoch is not None and epoch != expected_epoch:
        raise Refused('Binding lease is not the fixed deadline.')
    return epoch


def validate_current_binding(binding: dict, now_ms: int | None = None) -> dict:
    if (
        set(binding) != {'version', 'identity', 'reviewedAt', 'leaseNotBefore', 'leaseExpiresAt'}
        or binding.get('version') != 1
    ):
        raise Refused('Current binding has an invalid shape.')
    expires = _lease_moment(binding.get('leaseExpiresAt'), DEADLINE_EPOCH)
    reviewed = _lease_moment(binding.get('reviewedAt'), None)
    not_before = _lease_moment(binding.get('leaseNotBefore'), None)
    if reviewed != not_before or not_before >= expires:
        raise Refused('Binding lease triple is inconsistent.')
    now = int(time.time() * 1000) if now_ms is None else now_ms
    if now >= expires * 1000:
        raise Refused('Binding lease already expired.')
    identity = binding.get('identity')
    if not isinstance(identity, dict) or set(identity) != {'host', 'containers', 'networks', 'restRoutes'}:
        raise Refused('Current binding identity is invalid.')
    if _routes_tuple(identity.get('restRoutes')) != CURRENT_ROUTES:
        raise Refused('Current binding is not the pre-transition contract.')
    return identity


def _compact(value: object) -> bytes:
    return json.dumps(value, separators=(',', ':')).encode()


def render_transition_binding(current: dict, new_routes: tuple) -> dict:
    rendered: dict = {}
    for key, value in current.items():
        if key == 'identity':
            identity = dict(value)
            identity['restRoutes'] = [
                {'path': path, 'methods': list(methods)} for path, methods in new_routes
            ]
            rendered[key] = identity
        else:
            rendered[key] = value
    return rendered


def render_package_manifest(binding_bytes: bytes, new_routes: tuple) -> bytes:
    return _compact(
        {
            'version': 1,
            'files': {'binding.json': _sha(binding_bytes)},
            'restRoutes': [
                {'path': path, 'methods': list(methods)} for path, methods in new_routes
            ],
        }
    )


def build_package(directory: Path | None = None) -> dict[str, str]:
    target = Path.cwd() / PACKAGE_DIRECTORY_NAME if directory is None else directory
    if target.exists() or target.is_symlink():
        raise Refused('Transition package target already exists.')
    try:
        target.mkdir(mode=0o700, parents=False, exist_ok=False)
    except OSError as error:
        raise Refused('Transition package directory failed.') from error
    candidate = _load_pinned_candidate()
    binding, _ = _read_json(BINDING_PATH, 0, (0o440,))
    validate_current_binding(binding)
    rendered = render_transition_binding(binding, candidate.ROUTES)
    binding_bytes = _compact(rendered)
    manifest_bytes = render_package_manifest(binding_bytes, candidate.ROUTES)
    source = candidate.collect_transition_source()
    post_renewal = candidate.render_post_renewal_manifest(source['unitSha256'])
    post_renewal_bytes = _compact(post_renewal)
    owner_inputs = candidate.render_owner_inputs(
        source, _sha(manifest_bytes), _sha(post_renewal_bytes)
    )
    owner_inputs_bytes = _compact(owner_inputs)
    for name, content in (
        ('binding.json', binding_bytes),
        ('manifest.json', manifest_bytes),
        ('owner-inputs.json', owner_inputs_bytes),
        ('post-renewal-manifest.json', post_renewal_bytes),
    ):
        member = target / name
        try:
            descriptor = os.open(member, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except OSError as error:
            raise Refused('Transition package write failed.') from error
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
    return {
        'directory': str(target),
        'bindingSha256': _sha(binding_bytes),
        'manifestSha256': _sha(manifest_bytes),
        'ownerInputsSha256': _sha(owner_inputs_bytes),
        'postRenewalManifestSha256': _sha(post_renewal_bytes),
    }


def _validate_package(
    candidate, current_binding: dict, inputs: dict
) -> tuple[dict, bytes]:
    manifest, _ = _read_json(candidate.PACKAGE_MANIFEST_PATH, 0, (0o400, 0o600))
    if (
        set(manifest) != {'version', 'files', 'restRoutes'}
        or manifest.get('version') != 1
        or not isinstance(manifest.get('files'), dict)
        or set(manifest['files']) != {'binding.json'}
        or _routes_tuple(manifest.get('restRoutes')) != candidate.ROUTES
    ):
        raise Refused('Transition package manifest is invalid.')
    binding_bytes = _read_root_file(PACKAGE_BINDING_PATH, 0, (0o400, 0o600))
    if _sha(binding_bytes) != manifest['files']['binding.json']:
        raise Refused('Transition package binding does not match its manifest.')
    try:
        packaged = json.loads(binding_bytes)
    except (TypeError, ValueError) as error:
        raise Refused('Transition package binding is not valid JSON.') from error
    if not isinstance(packaged, dict):
        raise Refused('Transition package binding has an invalid shape.')
    expected = render_transition_binding(current_binding, candidate.ROUTES)
    if packaged != expected:
        raise Refused('Transition package binding is not the exact route swap.')
    if _routes_tuple(inputs['identity']['restRoutes']) != candidate.ROUTES:
        raise Refused('Owner inputs do not carry the exact route contract.')
    return packaged, binding_bytes


def _service_state(name: str) -> dict[str, str]:
    output = _run(
        [
            '/usr/bin/systemctl',
            'show',
            name,
            '--property=LoadState,ActiveState,MainPID,InvocationID,Restart,FragmentPath,DropInPaths,NeedDaemonReload',
            '--no-pager',
        ]
    )
    values: dict[str, str] = {}
    for line in output.splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in values:
            raise Refused('Systemd state is invalid.')
        values[key] = value
    expected = {
        'LoadState',
        'ActiveState',
        'MainPID',
        'InvocationID',
        'Restart',
        'FragmentPath',
        'DropInPaths',
        'NeedDaemonReload',
    }
    if set(values) != expected:
        raise Refused('Systemd state is incomplete.')
    if (
        values['LoadState'] != 'loaded'
        or values['FragmentPath'] != f'/etc/systemd/system/{name}'
        or values['Restart'] != 'no'
        or values['DropInPaths'] != ''
        or values['NeedDaemonReload'] != 'no'
    ):
        raise Refused('Systemd state rejected.')
    return values


def _gateway_account() -> tuple[int, int]:
    fields = _run(['/usr/bin/getent', 'passwd', GATEWAY_ACCOUNT]).strip().split(':')
    unit = _read_root_file(
        Path(f'/etc/systemd/system/{GATEWAY_SERVICE}'), 0, (0o444, 0o644)
    ).decode('utf-8')
    match = re.search(r'^Group=([^\n\r]+)$', unit, re.MULTILINE)
    if match is None:
        raise Refused('Gateway account rejected.')
    group_fields = (
        _run(['/usr/bin/getent', 'group', match.group(1)]).strip().split(':')
    )
    if (
        len(fields) != 7
        or not fields[2].isdigit()
        or len(group_fields) != 4
        or not group_fields[2].isdigit()
        or not re.search(r'^User=baci-savings-gateway$', unit, re.MULTILINE)
    ):
        raise Refused('Gateway account rejected.')
    return int(fields[2]), int(group_fields[2])


def _verify_socket(uid: int, gid: int) -> None:
    try:
        runtime = os.lstat(RUNTIME_DIRECTORY)
        socket = os.lstat(SOCKET_PATH)
    except OSError as error:
        raise Refused('Gateway socket is unavailable.') from error
    if (
        not stat.S_ISDIR(runtime.st_mode)
        or runtime.st_uid != uid
        or runtime.st_gid != gid
        or stat.S_IMODE(runtime.st_mode) != 0o750
        or not stat.S_ISSOCK(socket.st_mode)
        or socket.st_uid != uid
        or socket.st_gid != gid
        or stat.S_IMODE(socket.st_mode) != 0o660
    ):
        raise Refused('Gateway socket rejected.')


def _firewall_preflight() -> None:
    for bridge in ('baci-stg-db', 'baci-stg-mail'):
        _run(
            [
                '/usr/sbin/iptables',
                '-w',
                '5',
                '-C',
                'INPUT',
                '-i',
                bridge,
                '-m',
                'conntrack',
                '--ctstate',
                'NEW',
                '-m',
                'comment',
                '--comment',
                'baci-isolated-savings',
                '-j',
                'DROP',
            ]
        )


def _reachability_preflight(identity: dict) -> None:
    import http.client

    for name, port, path in (('auth', 9999, '/health'), ('rest', 3000, '/')):
        try:
            container = identity['containers'][name]
        except (KeyError, TypeError) as error:
            raise Refused('Gateway identity is invalid.') from error
        connection = http.client.HTTPConnection(container['ip'], port, timeout=3)
        try:
            connection.request(
                'GET', path, headers={'Host': STAGING_HOST}
            )
            response = connection.getresponse()
            response.read()
            if response.status != 200:
                raise Refused('Container reachability rejected.')
        except (OSError, http.client.HTTPException) as error:
            raise Refused('Container reachability rejected.') from error
        finally:
            connection.close()


def _collect_inventory() -> tuple[dict, int]:
    started_ms = int(time.time() * 1000)
    output = _run(
        ['/usr/bin/node', f'{GATEWAY_CODE}/managed-inventory-helper.mjs'],
        timeout=60,
    )
    try:
        inventory = json.loads(output)
    except (TypeError, ValueError) as error:
        raise Refused('Gateway inventory is invalid.') from error
    if not isinstance(inventory, dict) or set(inventory) != {
        'observedAt',
        'containers',
        'networks',
    }:
        raise Refused('Gateway inventory has an invalid shape.')
    return inventory, started_ms


def _node_check(program: str, payload: dict) -> None:
    _run(
        ['/usr/bin/node', '--input-type=module', '-e', program],
        timeout=15,
        payload=_compact(payload),
    )


def _build_evidence(
    packaged: dict, inventory: dict, started_ms: int
) -> tuple[dict, bytes]:
    identity = packaged['identity']
    evidence = {
        'inventory': inventory,
        'receipt': {
            'host': identity['host'],
            'containers': identity['containers'],
            'networks': identity['networks'],
            'restRoutes': identity['restRoutes'],
            'firewallVerified': True,
            'hostReachabilityVerified': True,
            'verifiedAt': datetime.fromtimestamp(
                started_ms / 1000, tz=UTC
            ).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'version': 1,
        },
    }
    return evidence, _compact(evidence)


def _validate_evidence(
    packaged: dict, evidence: dict, started_ms: int, now_ms: int
) -> None:
    if now_ms - started_ms >= EVIDENCE_FRESHNESS_MS:
        raise Refused('Stale transition evidence rejected.')
    receipt = evidence['receipt']
    _node_check(
        NODE_IDENTITY_PROGRAM,
        {
            'receipt': {
                'host': receipt['host'],
                'containers': receipt['containers'],
                'networks': receipt['networks'],
                'restRoutes': receipt['restRoutes'],
            },
            'inventory': evidence['inventory'],
        },
    )
    _node_check(
        NODE_STARTUP_PROGRAM,
        {'binding': packaged, 'evidence': evidence, 'now': now_ms},
    )


def _install_managed(path: Path, content: bytes, gid: int) -> None:
    _safe_ancestors(path, 0)
    try:
        current = path.lstat()
    except OSError as error:
        raise Refused('Managed target is unavailable.') from error
    if (
        not stat.S_ISREG(current.st_mode)
        or current.st_uid != 0
        or current.st_gid != gid
        or stat.S_IMODE(current.st_mode) != 0o440
        or current.st_nlink != 1
    ):
        raise Refused('Managed target permissions are unsafe.')
    staging = path.parent / f'.{path.name}.{os.getpid()}.transition'
    try:
        try:
            descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except OSError as error:
            raise Refused('Managed install staging failed.') from error
        try:
            with os.fdopen(descriptor, 'wb') as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.chown(staging, 0, gid)
            os.chmod(staging, 0o440)
            os.replace(staging, path)
        except (OSError, RuntimeError):
            try:
                os.unlink(staging)
            except OSError:
                pass
            raise
    except Refused:
        raise
    except OSError as error:
        raise Refused('Managed install failed.') from error


def _poll_gateway(previous_invocation: str, uid: int, gid: int) -> None:
    deadline = time.monotonic() + 10
    invocation_pattern = re.compile(r'[a-f0-9]{32}')
    while time.monotonic() < deadline:
        state = _service_state(GATEWAY_SERVICE)
        if (
            state['ActiveState'] == 'active'
            and state['MainPID'].isdigit()
            and int(state['MainPID']) > 0
            and invocation_pattern.fullmatch(state['InvocationID'])
            and state['InvocationID'] != previous_invocation
        ):
            try:
                _verify_socket(uid, gid)
            except Refused:
                pass
            else:
                return
        time.sleep(0.2)
    raise Refused('Gateway restart verification failed.')


def socket_probe(method: str, path: str) -> tuple[int, str]:
    output = _run(
        [
            '/usr/bin/curl',
            '-s',
            '-o',
            '/dev/null',
            '-w',
            '%{http_code} %{content_type}',
            '--max-time',
            '8',
            '--unix-socket',
            SOCKET_PATH,
            '-H',
            f'Host: {STAGING_HOST}',
            '-X',
            method,
            f'http://localhost{path}',
        ]
    )
    code, _, content_type = output.strip().partition(' ')
    if not code.isdigit():
        raise Refused('Gateway socket probe failed.')
    return int(code), content_type


BASELINE_PROBES = (
    ('GET', '/api/webhooks/piggyvest'),
    ('POST', '/rest/v1/rpc/customer_savings_draft_command'),
    ('GET', '/rest/v1/no_such_table'),
)

NEW_ROUTE_PROBES = (
    ('POST', '/rest/v1/rpc/get_customer_savings_feature_settings'),
    ('POST', '/rest/v1/rpc/get_merchant_paystack_subaccount_code'),
    ('POST', '/rest/v1/rpc/create_customer_savings_goal'),
    ('GET', '/rest/v1/customer_savings_goals?select=id'),
    ('GET', '/rest/v1/piggyvest_plan_wallets?select=customer_id'),
    ('GET', '/rest/v1/piggyvest_interest_payouts?select=wallet_id'),
)

# PostgREST semantic answers prove the request was routed through to the data
# plane (gateway denials are HTML). Server-error statuses fail the run.
ROUTED_STATUSES = frozenset({200, 201, 400, 401, 403, 404, 405, 409, 422})


def _probe_baseline() -> list[tuple[str, str, int, str]]:
    results = []
    for method, path in BASELINE_PROBES:
        code, content_type = socket_probe(method, path)
        results.append((method, path, code, content_type))
    return results


def _verify_post_transition(baseline: list[tuple[str, str, int, str]]) -> None:
    for (method, path, code, content_type), current in zip(
        baseline, _probe_baseline()
    ):
        if (method, path, current[2], current[3]) != (method, path, code, content_type):
            raise Refused('Gateway passthrough behavior changed.')
    for method, path in NEW_ROUTE_PROBES:
        code, content_type = socket_probe(method, path)
        if code not in ROUTED_STATUSES or 'json' not in content_type:
            raise Refused(f'Transitioned route {path} is not served.')


def _is_hash(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in '0123456789abcdef' for character in value)
    )


def _validate_provenance_base(base: object) -> dict:
    if (
        not isinstance(base, dict)
        or set(base)
        != {
            'version',
            'deadline',
            'predecessorReceiptSha256',
            'renewalReceiptSha256',
            'postRenewalManifestSha256',
            'packageManifestSha256',
            'archive',
            'routeContract',
        }
        or base.get('version') != 1
        or not isinstance(base.get('deadline'), str)
        or not isinstance(base.get('archive'), dict)
        or not isinstance(base.get('routeContract'), list)
        or not all(
            _is_hash(base.get(key))
            for key in (
                'predecessorReceiptSha256',
                'renewalReceiptSha256',
                'postRenewalManifestSha256',
                'packageManifestSha256',
            )
        )
    ):
        raise Refused('Transition provenance base is invalid.')
    return base


def _write_provenance(
    candidate, preflight: dict, activation: dict, state_directory: Path | None = None
) -> bytes:
    try:
        base = _validate_provenance_base(
            json.loads(candidate.render_provenance(preflight).decode())
        )
    except (TypeError, ValueError, AttributeError) as error:
        raise Refused('Transition provenance base is invalid.') from error
    receipt = {**base, 'activation': activation}
    content = _compact(receipt)
    directory = state_directory if state_directory is not None else STATE_DIRECTORY
    target = Path(directory) / PROVENANCE_NAME
    _safe_ancestors(target, 0)
    if target.exists() or target.is_symlink():
        raise Refused('Transition provenance receipt already exists.')
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    except OSError as error:
        raise Refused('Transition provenance write failed.') from error
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    return content


def _routes_canonical(routes) -> bytes:
    return _compact(
        [{'path': path, 'methods': list(methods)} for path, methods in routes]
    )


def _load_pinned_candidate():
    candidate = _load_candidate()
    for entry in candidate.ROUTES:
        if not (
            isinstance(entry, tuple)
            and len(entry) == 2
            and isinstance(entry[0], str)
            and isinstance(entry[1], tuple)
            and entry[1]
            and all(isinstance(method, str) for method in entry[1])
        ):
            raise Refused('Transition candidate routes are malformed.')
    if _sha(_routes_canonical(candidate.ROUTES)) != EXPECTED_ROUTES_SHA256:
        raise Refused('Transition candidate route contract drifted.')
    if tuple(candidate.ROUTES[:5]) != CURRENT_ROUTES:
        raise Refused('Transition is not a pure route extension.')
    return candidate


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


class _BaselineDiverged(RuntimeError):
    pass


def _rollback(context: dict, workdir: Path, cause: BaseException) -> None:
    errors = [f'{type(cause).__name__}: {cause}']
    try:
        restored = json.loads((workdir / 'binding.json').read_bytes())
        # Old binding first: inventory collection validates the live binding,
        # and the gateway refuses aged evidence, so rollback rebuilds fresh
        # evidence for the pre-transition routes instead of restoring bytes.
        _install_managed(BINDING_PATH, _compact(restored), context['gid'])
        inventory, started_ms = _collect_inventory()
        evidence, evidence_bytes = _build_evidence(restored, inventory, started_ms)
        _validate_evidence(
            restored, evidence, started_ms, int(time.time() * 1000)
        )
        _install_managed(EVIDENCE_PATH, evidence_bytes, context['gid'])
        _restart_gateway()
        _poll_gateway(context['previous_invocation'], context['uid'], context['gid'])
        for (method, path, code, content_type), current in zip(
            context['baseline'], _probe_baseline()
        ):
            if (current[2], current[3]) != (code, content_type):
                raise _BaselineDiverged(
                    f'Rollback restored files but {method} {path} diverged from baseline.'
                )
    except _BaselineDiverged as diverged:
        raise RolledBack(str(diverged) + f' Original failure: {errors[0]}')
    except Exception as rollback_error:  # noqa: BLE001 - report everything
        errors.append(f'{type(rollback_error).__name__}: {rollback_error}')
        raise Refused(
            'Transition activation failed and rollback failed; '
            f'backups kept at {workdir}; ' + '; '.join(errors)
        ) from rollback_error
    raise RolledBack('Transition activation failed; previous binding restored: ' + errors[0])


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


@contextlib.contextmanager
def _locked(path: Path | None = None):
    import fcntl

    target = LOCK_PATH if path is None else path
    try:
        descriptor = os.open(target, os.O_CREAT | os.O_RDWR, 0o600)
    except OSError as error:
        raise Refused('Transition lock is unavailable.') from error
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise Refused('Another transition run holds the lock.') from error
        try:
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


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
