"""Managed install, gateway polling, socket probes, provenance, and rollback fragment of funding-gateway-transition-activator.py.

Executed by the activator entry into its own namespace (see _load_fragment
in funding-gateway-transition-activator.py): one namespace keeps every
existing attribute and patch target working, and compile() with the real
filename keeps tracebacks accurate. Top-level names here may use the entry
namespace (imports, base paths, Refused); do not import or run directly.
"""


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
