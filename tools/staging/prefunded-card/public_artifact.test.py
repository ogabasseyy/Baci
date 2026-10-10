import hashlib
import io
import json
import tarfile
import unittest

import public_artifact as artifact
from treasury_owner_contract import Refused


def fixture(files=None, extra=None):
    files = files or {'launch-public.cjs': b'launch', 'apps/web/server.js': b'server', 'apps/web/empty': b''}
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
        if extra:
            archive.addfile(extra)
    content = output.getvalue()
    manifest = dict(version=1, count=len(files), bytes=sum(map(len, files.values())),
        files=[dict(path=name, sha256=hashlib.sha256(value).hexdigest(), size=len(value)) for name, value in files.items()],
        tarballSha256=hashlib.sha256(content).hexdigest(), tarballSize=len(content))
    return content, manifest, files


class ArtifactTests(unittest.TestCase):
    def decode(self, content, manifest):
        raw = json.dumps(manifest).encode()
        return artifact.validate_archive(content, raw, hashlib.sha256(content).hexdigest(), hashlib.sha256(raw).hexdigest())

    def test_exact_captured_bytes_include_empty_file(self):
        content, manifest, files = fixture()
        self.assertEqual(self.decode(content, manifest), files)

    def test_independent_archive_and_manifest_pins_required(self):
        content, manifest, _ = fixture()
        raw = json.dumps(manifest).encode()
        for archive_pin, manifest_pin in (('f' * 64, hashlib.sha256(raw).hexdigest()),
                (hashlib.sha256(content).hexdigest(), 'e' * 64)):
            with self.assertRaises(Refused):
                artifact.validate_archive(content, raw, archive_pin, manifest_pin)

    def test_manifest_shape_counts_sizes_hashes_and_required_entrypoints(self):
        content, original, _ = fixture()
        for name, value in (('version', True), ('count', None), ('bytes', 0), ('tarballSize', 1),
                            ('tarballSha256', 'b' * 64), ('files', []), ('extra', 'unreviewed')):
            manifest = {**original, name: value}
            with self.subTest(name=name), self.assertRaises(Refused):
                self.decode(content, manifest)
        for key, value in (('sha256', 'c' * 64), ('size', None), ('link', True)):
            manifest = json.loads(json.dumps(original))
            manifest['files'][0][key] = value
            with self.subTest(key=key), self.assertRaises(Refused):
                self.decode(content, manifest)
        content, manifest, _ = fixture({'unknown': b'app'})
        with self.assertRaises(Refused):
            self.decode(content, manifest)

    def test_rejects_traversal_absolute_control_and_file_parent_collisions(self):
        for name in ('../escape', '/absolute', 'apps//bad', 'apps/./bad', 'apps/../bad', 'apps\\bad', 'apps/line\n'):
            content, manifest, _ = fixture({'launch-public.cjs': b'a', 'apps/web/server.js': b'b', name: b'c'})
            with self.subTest(name=name), self.assertRaises(Refused):
                self.decode(content, manifest)
        content, manifest, _ = fixture({'launch-public.cjs': b'a', 'apps/web/server.js': b'b', 'apps': b'collision'})
        with self.assertRaises(Refused):
            self.decode(content, manifest)

    def test_rejects_unlisted_duplicate_link_hardlink_fifo_and_device_members(self):
        for name, kind, target in (('unexpected', tarfile.REGTYPE, ''), ('launch-public.cjs', tarfile.REGTYPE, ''),
                ('link', tarfile.SYMTYPE, '/etc'), ('hard', tarfile.LNKTYPE, 'launch-public.cjs'),
                ('pipe', tarfile.FIFOTYPE, ''), ('dev', tarfile.CHRTYPE, '')):
            member = tarfile.TarInfo(name)
            member.type, member.linkname = kind, target
            content, manifest, _ = fixture(extra=member)
            with self.subTest(name=name), self.assertRaises(Refused):
                self.decode(content, manifest)

    def test_refuses_manifest_duplicate_keys_and_links_even_if_hashes_match(self):
        content, manifest, _ = fixture()
        manifest['files'][0] = {'path': 'launch-public.cjs', 'link': True, 'target': 'apps/web/server.js'}
        with self.assertRaises(Refused):
            self.decode(content, manifest)
        raw = b'{"version":1,"version":1}'
        with self.assertRaises(Refused):
            artifact.validate_archive(content, raw, hashlib.sha256(content).hexdigest(), hashlib.sha256(raw).hexdigest())

    def test_accepts_only_expected_tar_directories_with_dot_prefix(self):
        member = tarfile.TarInfo('./apps/web/')
        member.type = tarfile.DIRTYPE
        content, manifest, files = fixture(extra=member)
        self.assertEqual(self.decode(content, manifest), files)
        member = tarfile.TarInfo('extra/')
        member.type = tarfile.DIRTYPE
        content, manifest, _ = fixture(extra=member)
        with self.assertRaises(Refused):
            self.decode(content, manifest)


if __name__ == '__main__':
    unittest.main()
