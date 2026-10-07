import ast
import hashlib
import json
from pathlib import Path
import sys
import sysconfig

from mutation_contract import FINANCIAL_SEAL, FLAG
from readiness_evidence_io import inspection
from release_contract import _require
from runtime_owner_support import DOCKER, command
import replay_cutover_runtime
import runtime_scheduler
from treasury_owner_io import read_file, root_ancestors


class RuntimeBounds:
    SIDECARS = ('mutation_contract', 'mutation_chain', 'mutation_runtime', 'mutation_gate',
                'mutation_owner', 'systemd_deadline_reader', 'mutation_runtime_bounds')

    def __init__(self, bundle, seal, seal_sha):
        self.bundle = Path(bundle)
        self.seal = seal
        self.seal_sha = seal_sha

    def verify_sources(self):
        _require(self.seal_sha == FINANCIAL_SEAL, 'public_mutation_bounds_r8_required')
        root = self.bundle
        _require(root.is_absolute() and root == root.resolve(), 'public_mutation_source_root_refused')
        raw = (root / 'financial-preparation.json').read_bytes()
        _require(hashlib.sha256(raw).hexdigest() == self.seal_sha
                 and json.loads(raw) == self.seal, 'public_mutation_source_seal_refused')
        files = self.seal['files']
        candidates = {}
        for relative, expected in files.items():
            path = Path(relative)
            _require(not path.is_absolute() and '..' not in path.parts,
                     'public_mutation_bounds_path_refused')
            if path.suffix == '.py' and path.parts[0] in ('tooling', 'contracts'):
                candidates.setdefault(path.stem, {})[root / path] = expected
        pending = list(self.SIDECARS)
        seen = {}
        sidecar_root = Path(__file__).resolve().parent
        stdlib = Path(sysconfig.get_path('stdlib')).resolve()
        while pending:
            name = pending.pop()
            if name in seen or name in sys.builtin_module_names:
                continue
            module = sys.modules.get(name)
            path_text = getattr(module, '__file__', None)
            _require(isinstance(path_text, str), 'public_mutation_dependency_not_loaded')
            path = Path(path_text)
            _require(path.is_absolute() and path == path.resolve(),
                     'public_mutation_dependency_path_refused')
            if name in self.SIDECARS:
                _require(path == sidecar_root / (name + '.py'),
                         'public_mutation_sidecar_module_path_refused')
            elif name in candidates:
                _require(path in candidates[name], 'public_mutation_dependency_outside_r8')
            else:
                _require(path.is_relative_to(stdlib) and not any(part in
                    ('site-packages', 'dist-packages') for part in path.parts),
                    'public_mutation_unsealed_dependency')
                seen[name] = 'stdlib'
                continue
            content = path.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            if name not in self.SIDECARS:
                _require(digest == candidates[name][path], 'public_mutation_dependency_source_drift')
            seen[name] = {'path': str(path), 'sha256': digest}
            for node in ast.walk(ast.parse(content)):
                if isinstance(node, ast.Import):
                    pending.extend(alias.name for alias in node.names)
                elif isinstance(node, ast.ImportFrom):
                    _require(not node.level and node.module, 'public_mutation_relative_import_refused')
                    pending.append(node.module)
        wrapper_source = root / 'tooling/background-runner.sh'
        _require(Path(runtime_scheduler.__file__) == root / 'tooling/runtime_scheduler.py'
                 and str(runtime_scheduler.__file__) == seen['runtime_scheduler']['path']
                 and wrapper_source == wrapper_source.resolve()
                 and hashlib.sha256(wrapper_source.read_bytes()).hexdigest()
                 == files['tooling/background-runner.sh'], 'public_mutation_wrapper_source_drift')
        return seen

    def verify_runtime(self, run=command):
        sources = self.verify_sources()
        expected_wrapper = runtime_scheduler.background_wrapper().encode()
        installed = Path('/opt/baci-prefunded-workers/code/background.sh')
        root_ancestors(installed)
        _require(read_file(installed, 0, 0o444, 1_000_000) == expected_wrapper,
                 'public_mutation_installed_wrapper_drift')
        images = {}
        for image in {runtime_scheduler.IMAGE, replay_cutover_runtime.IMAGE}:
            rows = json.loads(run([*DOCKER, 'image', 'inspect', image]))
            _require(isinstance(rows, list) and len(rows) == 1 and rows[0]['Id'] == image,
                     'public_mutation_financial_image_refused')
            environment = rows[0]['Config']['Env']
            _require(isinstance(environment, list) and all(isinstance(entry, str)
                     and '=' in entry for entry in environment), 'public_mutation_image_environment_refused')
            keys = [entry.split('=', 1)[0] for entry in environment]
            _require(len(keys) == len(set(keys)) and FLAG not in keys,
                     'public_mutation_image_mutation_flag_refused')
            images[image] = environment
        containers = {}
        for kind in ('background', 'snapshot', 'readiness', 'replay', 'replay-check'):
            replay = kind.startswith('replay')
            name = (replay_cutover_runtime.CONTAINER + ('-check' if kind == 'replay-check' else '')
                    if replay else 'baci-prefunded-' + kind)
            row = inspection(name, run)
            if replay:
                replay_cutover_runtime.validate_container(row, '/opt/baci-prefunded-replay',
                    self.seal_sha, check=kind == 'replay-check')
            else:
                runtime_scheduler.validate_container(row, kind, self.seal_sha)
            _require(row['Config']['Env'] == images[row['Image']],
                     'public_mutation_financial_environment_drift')
            _require(isinstance(row.get('Id'), str) and len(row['Id']) == 64
                     and all(letter in '0123456789abcdef' for letter in row['Id']),
                     'public_mutation_financial_container_identity_refused')
            containers[name] = row['Id']
        _require(read_file(installed, 0, 0o444, 1_000_000) == expected_wrapper
                 and self.verify_sources() == sources, 'public_mutation_runtime_bounds_changed')
        return containers

    def guarded_run(self, arguments, run=command):
        if arguments in ([*DOCKER, 'start', '--attach', 'baci-prefunded-readiness'],
                [*DOCKER, 'start', '--attach', replay_cutover_runtime.CONTAINER + '-check']):
            self.verify_runtime(run)
        return run(arguments)
