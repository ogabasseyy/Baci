import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import seal_release as seal


class ReleaseSealTests(unittest.TestCase):
    def artifact(self, directory, server, next_version='16.2.9'):
        directory.mkdir()
        files = {'launch-public.cjs': b'unchanged launcher', 'apps/web/server.js': server,
            'node_modules/next/package.json': json.dumps({'version': next_version}).encode()}
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            for name, content in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
        raw = stream.getvalue()
        archive_sha = hashlib.sha256(raw).hexdigest()
        manifest = {'version': 1, 'count': len(files), 'bytes': sum(map(len, files.values())),
            'files': [{'path': name, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                for name, content in files.items()], 'tarballSha256': archive_sha, 'tarballSize': len(raw)}
        report = json.dumps(manifest).encode()
        (directory / 'public-app.tar.gz').write_bytes(raw)
        (directory / 'public-app.manifest.json').write_bytes(report)
        return archive_sha, hashlib.sha256(report).hexdigest()

    def fixture(self, root, next_version='16.2.9'):
        old_release, new_release, source = (root / name for name in ('old', 'new', 'source'))
        archive_sha, manifest_sha = self.artifact(old_release, b'old server', next_version)
        self.artifact(new_release, b'new server', next_version)
        source.mkdir()
        provider = source / seal.PROVIDER
        provider.parent.mkdir(parents=True)
        provider.write_bytes(b'new provider')
        new_provider_sha = hashlib.sha256(b'new provider').hexdigest()
        old_meta = {'version': 2, 'sources': {seal.PROVIDER: seal.OLD_PROVIDER_SHA}, 'rewrites': {}, 'generated': {}}
        old_raw = json.dumps(old_meta).encode()
        new_meta = {**old_meta, 'sources': {seal.PROVIDER: new_provider_sha}}
        new_raw = json.dumps(new_meta).encode()
        (source / 'predecessor-source-manifest.json').write_bytes(old_raw)
        (source / 'source-manifest.json').write_bytes(new_raw)
        attestation = root / 'builder.json'
        build = {'network': 'none', 'exitCode': 0, 'nodeMajor': 22, 'nextVersion': next_version,
            'routesVerified': True, 'sourceInputsVerified': True, 'flags': ['--webpack'],
            'imageId': 'sha256:' + '1' * 64, 'dependencyTreeSha256': '2' * 64,
            'sourceManifestSha256': hashlib.sha256(new_raw).hexdigest()}
        attestation.write_bytes(json.dumps(build).encode())
        overrides = {'OLD_ARCHIVE': archive_sha, 'OLD_MANIFEST': manifest_sha,
            'OLD_SOURCE': hashlib.sha256(old_raw).hexdigest(), 'PROVIDER_SHA': new_provider_sha,
            'LAUNCHER': hashlib.sha256(b'unchanged launcher').hexdigest()}
        return old_release, new_release, source, attestation, overrides

    def test_seals_real_artifact_bytes_additively_without_claiming_installation(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as temporary:
            old, new, source, attestation, overrides = self.fixture(Path(temporary))
            with patch.multiple(seal, **overrides):
                result = seal.seal_release(old, new, source, '3' * 64, attestation,
                    hashlib.sha256(attestation.read_bytes()).hexdigest())
            self.assertFalse(result['installed'])
            self.assertEqual(result['originalR8SealSha256'], seal.R8)
            self.assertEqual([row['path'] for row in result['changedArchiveFiles']], ['apps/web/server.js'])
            self.assertTrue((new / 'additive-public-chain.json').is_file())

    def test_refuses_unpinned_builder_evidence_and_environment_or_source_drift(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as temporary:
            old, new, source, attestation, overrides = self.fixture(Path(temporary))
            with patch.multiple(seal, **overrides):
                with self.assertRaisesRegex(ValueError, 'attestation-pin'):
                    seal.seal_release(old, new, source, '3' * 64, attestation, '4' * 64)
                value = json.loads(attestation.read_bytes())
                value['network'] = 'host'
                attestation.write_bytes(json.dumps(value).encode())
                with self.assertRaisesRegex(ValueError, 'offline-builder'):
                    seal.seal_release(old, new, source, '3' * 64, attestation,
                        hashlib.sha256(attestation.read_bytes()).hexdigest())
            self.assertFalse((new / 'additive-public-chain.json').exists())

    def test_uses_the_validated_archive_framework_version_instead_of_the_repo_documentation(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as temporary:
            old, new, source, attestation, overrides = self.fixture(Path(temporary), '16.3.4')
            with patch.multiple(seal, **overrides):
                result = seal.seal_release(old, new, source, '3' * 64, attestation,
                    hashlib.sha256(attestation.read_bytes()).hexdigest())
            self.assertEqual(result['frameworkVersion'], '16.3.4')

    def test_refuses_a_builder_framework_version_different_from_the_installed_archive(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as temporary:
            old, new, source, attestation, overrides = self.fixture(Path(temporary))
            build = json.loads(attestation.read_bytes())
            build['nextVersion'] = '16.3.4'
            attestation.write_bytes(json.dumps(build).encode())
            with patch.multiple(seal, **overrides):
                with self.assertRaisesRegex(ValueError, 'offline-builder'):
                    seal.seal_release(old, new, source, '3' * 64, attestation,
                        hashlib.sha256(attestation.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
