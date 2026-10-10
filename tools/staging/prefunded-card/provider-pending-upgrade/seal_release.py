import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'tooling' if (HERE / 'tooling').is_dir() else HERE.parent))
from public_artifact import validate_archive

OLD_ARCHIVE = '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2'
OLD_MANIFEST = '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8'
OLD_SOURCE = '4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7'
LAUNCHER = 'd0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03'
R8 = 'c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086'
PROVIDER = 'apps/web/src/lib/piggyvest/prefunded-card-checkout-provider.ts'
PROVIDER_SHA = '6acb4d8a5b69984224bf7754c97bcefa93c38cf78b6f5ea0c014d561c0ed22e8'
OLD_PROVIDER_SHA = '3965a85d8f2966a49e0df39fbc5019e96ab7e2514f47bf16a65dd7cd6afce785'
DEADLINE = '2026-10-06T15:59:10Z'
HEX = re.compile(r'^[a-f0-9]{64}$')


def seal_release(old_release, new_release, source, parent_chain, attestation, attestation_sha):
    old_release, new_release, source, attestation = map(Path, (old_release, new_release, source, attestation))
    if not HEX.fullmatch(parent_chain) or not HEX.fullmatch(attestation_sha):
        raise ValueError('independent-parent-and-builder-pins-required')
    old_archive = (old_release / 'public-app.tar.gz').read_bytes()
    old_manifest = (old_release / 'public-app.manifest.json').read_bytes()
    old_files = validate_archive(old_archive, old_manifest, OLD_ARCHIVE, OLD_MANIFEST)
    next_versions = {json.loads(content).get('version') for name, content in old_files.items()
        if name == 'node_modules/next/package.json' or name.endswith('/node_modules/next/package.json')}
    if len(next_versions) != 1 or not all(isinstance(value, str) and value for value in next_versions):
        raise ValueError('installed-framework-version-proof-required')
    installed_next_version = next(iter(next_versions))
    old_source = (source / 'predecessor-source-manifest.json').read_bytes()
    if hashlib.sha256(old_source).hexdigest() != OLD_SOURCE:
        raise ValueError('exact-predecessor-source-required')
    old_meta = json.loads(old_source)
    if old_meta['sources'].get(PROVIDER) != OLD_PROVIDER_SHA:
        raise ValueError('old-provider-pin-required')
    new_source = (source / 'source-manifest.json').read_bytes()
    new_meta = json.loads(new_source)
    expected_meta = {**old_meta, 'sources': {**old_meta['sources'], PROVIDER: PROVIDER_SHA}}
    if new_meta != expected_meta:
        raise ValueError('unrelated-source-delta-refused')
    for name, expected in {**new_meta['sources'], **new_meta['rewrites'], **new_meta['generated']}.items():
        target = source / name
        if (target.is_symlink() or not target.resolve().is_relative_to(source.resolve())
                or hashlib.sha256(target.read_bytes()).hexdigest() != expected):
            raise ValueError('candidate-source-drift')
    build_raw = attestation.read_bytes()
    if hashlib.sha256(build_raw).hexdigest() != attestation_sha:
        raise ValueError('builder-attestation-pin-drift')
    build = json.loads(build_raw)
    if (build.get('network') != 'none' or build.get('exitCode') != 0
            or build.get('nodeMajor') != 22 or build.get('nextVersion') != installed_next_version
            or build.get('routesVerified') is not True or build.get('sourceInputsVerified') is not True
            or build.get('sourceManifestSha256') != hashlib.sha256(new_source).hexdigest()
            or build.get('flags') != ['--webpack']
            or not re.fullmatch(r'sha256:[a-f0-9]{64}', build.get('imageId', ''))
            or not HEX.fullmatch(build.get('dependencyTreeSha256', ''))):
        raise ValueError('offline-builder-proof-required')
    archive = (new_release / 'public-app.tar.gz').read_bytes()
    manifest = (new_release / 'public-app.manifest.json').read_bytes()
    archive_sha, manifest_sha = (hashlib.sha256(value).hexdigest() for value in (archive, manifest))
    new_files = validate_archive(archive, manifest, archive_sha, manifest_sha)
    new_next_versions = {json.loads(content).get('version') for name, content in new_files.items()
        if name == 'node_modules/next/package.json' or name.endswith('/node_modules/next/package.json')}
    if new_next_versions != next_versions:
        raise ValueError('framework-dependency-upgrade-refused')
    if (archive_sha == OLD_ARCHIVE or manifest_sha == OLD_MANIFEST
            or hashlib.sha256(old_files['launch-public.cjs']).hexdigest() != LAUNCHER
            or new_files['launch-public.cjs'] != old_files['launch-public.cjs']):
        raise ValueError('successor-or-launcher-pin-refused')
    changed = [{'path': name, 'predecessorSha256': hashlib.sha256(old_files[name]).hexdigest() if name in old_files else None,
        'successorSha256': hashlib.sha256(new_files[name]).hexdigest() if name in new_files else None}
        for name in sorted(set(old_files) | set(new_files)) if old_files.get(name) != new_files.get(name)]
    chain = {'version': 1, 'status': 'compiled-public-successor-parent-review-required',
        'originalR8SealSha256': R8, 'parentChainSha256': parent_chain, 'deadline': DEADLINE,
        'predecessor': {'archiveSha256': OLD_ARCHIVE, 'manifestSha256': OLD_MANIFEST, 'sourceManifestSha256': OLD_SOURCE},
        'successor': {'archiveSha256': archive_sha, 'manifestSha256': manifest_sha,
            'sourceManifestSha256': hashlib.sha256(new_source).hexdigest(), 'providerSha256': PROVIDER_SHA},
        'launcherSha256': LAUNCHER, 'frameworkVersion': installed_next_version,
        'builderAttestationSha256': attestation_sha,
        'changedArchiveFiles': changed, 'runtimeBaselineStillRequired': True,
        'installed': False, 'databaseChanged': False, 'providerCalls': False, 'newPaymentStarted': False}
    raw = (json.dumps(chain, sort_keys=True, indent=2) + '\n').encode()
    with (new_release / 'additive-public-chain.json').open('xb') as handle:
        handle.write(raw)
    (new_release / 'additive-public-chain.json').chmod(0o600)
    return {'chainSha256': hashlib.sha256(raw).hexdigest(), **chain}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('old-release', 'new-release', 'source', 'parent-chain', 'attestation', 'attestation-sha256'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    print(json.dumps(seal_release(args.old_release, args.new_release, args.source, args.parent_chain,
        args.attestation, args.attestation_sha256), sort_keys=True))
