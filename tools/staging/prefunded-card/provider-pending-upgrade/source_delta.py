import argparse
import hashlib
import json
from pathlib import Path
import shutil

PROVIDER = 'apps/web/src/lib/piggyvest/prefunded-card-checkout-provider.ts'
PROVIDER_SHA = '6acb4d8a5b69984224bf7754c97bcefa93c38cf78b6f5ea0c014d561c0ed22e8'
OLD_PROVIDER_SHA = '3965a85d8f2966a49e0df39fbc5019e96ab7e2514f47bf16a65dd7cd6afce785'
OLD_SOURCE_SHA = '4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7'
ADDED_LINE = b"          status === 'abandoned' ||\n"


def prepare_source(predecessor, provider_file, output):
    predecessor, provider_file, output = map(Path, (predecessor, provider_file, output))
    raw = (predecessor / 'source-manifest.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != OLD_SOURCE_SHA:
        raise ValueError('exact-installed-source-manifest-required')
    manifest = json.loads(raw)
    if set(manifest) != {'version', 'sources', 'rewrites', 'generated'} or manifest['version'] != 2:
        raise ValueError('source-manifest-shape-refused')
    sources, rewrites, generated = (manifest[name] for name in ('sources', 'rewrites', 'generated'))
    if (sources.get(PROVIDER) != OLD_PROVIDER_SHA or PROVIDER in rewrites
            or set(sources) & set(generated) or not set(rewrites) <= set(sources)):
        raise ValueError('provider-or-generated-predecessor-drift')
    updated = provider_file.read_bytes()
    if (hashlib.sha256(updated).hexdigest() != PROVIDER_SHA
            or updated.count(ADDED_LINE) != 1
            or hashlib.sha256(updated.replace(ADDED_LINE, b'', 1)).hexdigest() != OLD_PROVIDER_SHA):
        raise ValueError('exact-one-line-provider-delta-required')
    files = {**sources, **rewrites, **generated}
    captured = {}
    for name, expected in files.items():
        relative = Path(name)
        if (relative.is_absolute() or '..' in relative.parts or relative.as_posix() != name
                or any(part.startswith('.env') for part in relative.parts)
                or relative.name in ('proxy.ts', 'middleware.ts')):
            raise ValueError('source-path-refused')
        target = predecessor / relative
        if (target.is_symlink() or not target.is_file()
                or not target.resolve().is_relative_to(predecessor.resolve())):
            raise ValueError('unsafe-predecessor-source')
        content = target.read_bytes()
        if len(content) > 2_000_000 or hashlib.sha256(content).hexdigest() != expected:
            raise ValueError('predecessor-source-pin-drift')
        captured[name] = content
    if sum(map(len, captured.values())) > 16_000_000:
        raise ValueError('source-kit-size-refused')
    if output.exists() or output.is_symlink():
        raise ValueError('fresh-source-output-required')
    output.mkdir(mode=0o700)
    for name, content in captured.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(updated if name == PROVIDER else content)
        target.chmod(0o600)
    (output / 'apps/web/public').mkdir(parents=True, exist_ok=True)
    manifest['sources'] = {**sources, PROVIDER: PROVIDER_SHA}
    new_raw = (json.dumps(manifest, sort_keys=True, indent=2) + '\n').encode()
    (output / 'source-manifest.json').write_bytes(new_raw)
    (output / 'source-manifest.json').chmod(0o600)
    shutil.copyfile(predecessor / 'source-manifest.json', output / 'predecessor-source-manifest.json')
    (output / 'predecessor-source-manifest.json').chmod(0o600)
    return {'status': 'provider-only-source-prepared', 'predecessorSourceSha256': OLD_SOURCE_SHA,
        'sourceManifestSha256': hashlib.sha256(new_raw).hexdigest(), 'providerSha256': PROVIDER_SHA,
        'sourceCount': len(sources), 'buildExecuted': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--predecessor-source', required=True)
    parser.add_argument('--provider', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(prepare_source(args.predecessor_source, args.provider, args.output), sort_keys=True))
