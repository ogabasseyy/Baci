"""Shared pins, guarded IO, subprocess, and lock primitives fragment of funding-gateway-transition-activator.py.

Executed by the activator entry into its own namespace (see _load_fragment
in funding-gateway-transition-activator.py): one namespace keeps every
existing attribute and patch target working, and compile() with the real
filename keeps tracebacks accurate. Top-level names here may use the entry
namespace (imports, base paths, Refused); do not import or run directly.
"""


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
