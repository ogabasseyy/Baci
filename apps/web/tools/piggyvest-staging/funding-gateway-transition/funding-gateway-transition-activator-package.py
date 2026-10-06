"""Transition package construction and validation fragment of funding-gateway-transition-activator.py.

Executed by the activator entry into its own namespace (see _load_fragment
in funding-gateway-transition-activator.py): one namespace keeps every
existing attribute and patch target working, and compile() with the real
filename keeps tracebacks accurate. Top-level names here may use the entry
namespace (imports, base paths, Refused); do not import or run directly.
"""


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
