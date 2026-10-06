"""Service, socket, firewall, reachability, inventory, and evidence checks fragment of funding-gateway-transition-activator.py.

Executed by the activator entry into its own namespace (see _load_fragment
in funding-gateway-transition-activator.py): one namespace keeps every
existing attribute and patch target working, and compile() with the real
filename keeps tracebacks accurate. Top-level names here may use the entry
namespace (imports, base paths, Refused); do not import or run directly.
"""


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
