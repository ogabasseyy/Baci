import importlib.util
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPECIFICATION = importlib.util.spec_from_file_location('complete_artifact_contract', HERE / 'contract.py')
contract = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(contract)
FRAMING = {'replay-daemon.mjs', 'replay-artifact.manifest.json', 'daemon-closure.json'}


def _pinned_json(files, name, expected):
    content = files.get(name)
    contract.require(type(content) is bytes and contract.sha(content) == expected, 'artifact_pin_refused')
    value = contract.private_json(content)
    contract.require(isinstance(value, dict), 'artifact_shape_refused')
    return value


def validate_artifact(files):
    contract.require(isinstance(files, dict) and FRAMING <= set(files), 'daemon_artifact_required')
    contract.require(all(type(content) is bytes and 0 < len(content) <= 16 * 1024 * 1024
                         for content in files.values())
                     and sum(len(content) for content in files.values()) <= 32 * 1024 * 1024,
                     'artifact_size_refused')
    daemon = files['replay-daemon.mjs']
    contract.require(contract.sha(daemon) == contract.COMPLETE_DAEMON_SHA256,
                     'reviewed_complete_daemon_required')
    pins = contract.DAEMON_ARTIFACT
    closure = _pinned_json(files, 'daemon-closure.json', pins['closureSha256'])
    manifest = _pinned_json(files, 'replay-artifact.manifest.json', pins['buildManifestSha256'])
    expected = dict(schemaVersion=1, scope='daemon-only', daemonSha256=contract.COMPLETE_DAEMON_SHA256,
                    buildManifestSha256=pins['buildManifestSha256'],
                    preservedFactorySha256=contract.PREDECESSOR_FILES['code/prefunded-replay-bundle.mjs'],
                    preservedPrivateConfigurationSha256=contract.PREDECESSOR_FILES['config/prefunded.json'],
                    generatedFactoryNotForInstallation=True)
    contract.require(set(closure) == set(expected) | {'sources', 'runtimeImports'}
                     and all(type(closure[name]) is type(value) and closure[name] == value
                             for name, value in expected.items()), 'artifact_scope_refused')
    sources = closure['sources']
    contract.require(isinstance(sources, list) and len(sources) == contract.DAEMON_INPUTS
                     and contract.digest(sources) == pins['sourceTableSha256'], 'artifact_source_table_refused')
    paths = []
    captures = set()
    for source in sources:
        contract.require(isinstance(source, dict) and set(source) == {'path', 'sha256', 'capture'}
                         and isinstance(source['path'], str) and source['path'].startswith('/')
                         and contract.hex_digest(source['sha256'])
                         and source['capture'] == 'captures/' + source['sha256'] + '.source',
                         'artifact_capture_shape_refused')
        content = files.get(source['capture'])
        contract.require(type(content) is bytes and contract.sha(content) == source['sha256'],
                         'artifact_capture_pin_refused')
        paths.append(source['path'])
        captures.add(source['capture'])
    contract.require(paths == sorted(set(paths)) and set(files) == FRAMING | captures,
                     'artifact_file_set_refused')
    contract.require(set(manifest) == {'version', 'source', 'outputs'}
                     and type(manifest['version']) is int and manifest['version'] == 1
                     and isinstance(manifest['outputs'], dict)
                     and set(manifest['outputs']) == {'replay-daemon.mjs', 'prefunded-replay-bundle.mjs'}
                     and manifest['outputs']['replay-daemon.mjs'] == contract.COMPLETE_DAEMON_SHA256,
                     'build_manifest_shape_refused')
    source = manifest['source']
    contract.require(isinstance(source, dict) and set(source) == {
        'receiverRoot', 'savingsRoot', 'entrypoints', 'inputs'}
        and isinstance(source['inputs'], dict) and set(source['inputs']) == {'receiver', 'prefundedReplay'},
        'build_manifest_source_refused')
    production = source['inputs']['receiver']
    contract.require(isinstance(production, list) and len(production) == contract.PRODUCTION_INPUTS
                     and contract.digest(production) == pins['productionTableSha256'],
                     'production_table_refused')
    captured_table = [{'path': item['path'], 'sha256': item['sha256']} for item in sources]
    contract.require(all(item in captured_table for item in production), 'production_capture_missing')
    imports = closure['runtimeImports']
    contract.require(isinstance(imports, list) and contract.digest(imports) == contract.RUNTIME_IMPORTS_SHA256
                     and all(isinstance(item, dict) and item.get('external') is True for item in imports),
                     'runtime_imports_refused')
    return dict(pins)
