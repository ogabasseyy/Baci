import hashlib
import io
from pathlib import PurePosixPath
import re
import tarfile

from public_projection import parsed
from treasury_owner_contract import Refused


ARCHIVE_LIMIT = 268435456
EXPANDED_LIMIT = 400_000_000
FILE_LIMIT = 64_000_000
MANIFEST_LIMIT = 16777216


def digest(content):
    return hashlib.sha256(content).hexdigest()


def path_name(name):
    if (not isinstance(name, str) or not name or len(name) > 4096 or '\\' in name
            or any(ord(character) < 32 or ord(character) == 127 for character in name)
            or name.startswith('/') or any(part in ('', '.', '..') for part in name.split('/'))):
        raise Refused('Public archive path refused')
    return name


def validate_archive(content, manifest_content, archive_sha256, manifest_sha256):
    try:
        if (len(content) > ARCHIVE_LIMIT or len(manifest_content) > MANIFEST_LIMIT
                or any(not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value)
                       for value in (archive_sha256, manifest_sha256))
                or digest(content) != archive_sha256 or digest(manifest_content) != manifest_sha256):
            raise ValueError()
        manifest = parsed(manifest_content)
        if (set(manifest) != {'version', 'count', 'bytes', 'files', 'tarballSha256', 'tarballSize'}
                or type(manifest['version']) is not int or manifest['version'] != 1
                or type(manifest['count']) is not int or not 2 <= manifest['count'] <= 40000
                or type(manifest['bytes']) is not int or not 0 < manifest['bytes'] <= EXPANDED_LIMIT
                or type(manifest['tarballSize']) is not int or manifest['tarballSize'] != len(content)
                or manifest['tarballSha256'] != archive_sha256
                or not isinstance(manifest['files'], list) or len(manifest['files']) != manifest['count']):
            raise ValueError()
        expected, directories = {}, {'.'}
        for item in manifest['files']:
            if (set(item) != {'path', 'sha256', 'size'} or type(item['size']) is not int
                    or not 0 <= item['size'] <= FILE_LIMIT
                    or not isinstance(item['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', item['sha256'])):
                raise ValueError()
            name = path_name(item['path'])
            if name in expected:
                raise ValueError()
            expected[name] = item
            directories.update(str(parent) for parent in PurePosixPath(name).parents)
        if (directories.intersection(expected) or sum(item['size'] for item in expected.values()) != manifest['bytes']
                or any(name not in expected or expected[name]['size'] == 0
                       for name in ('launch-public.cjs', 'apps/web/server.js'))):
            raise ValueError()
        files, seen = {}, set()
        with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
            for member in archive:
                name = member.name.removeprefix('./')
                if name in seen or len(seen) > 100000:
                    raise ValueError()
                seen.add(name)
                if member.isdir():
                    if name.rstrip('/') not in directories:
                        raise ValueError()
                    continue
                path_name(name)
                if (not member.isreg() or member.issparse() or name not in expected
                        or member.size != expected[name]['size']):
                    raise ValueError()
                with archive.extractfile(member) as handle:
                    data = handle.read(member.size + 1)
                if len(data) != member.size or digest(data) != expected[name]['sha256']:
                    raise ValueError()
                files[name] = data
        if set(files) != set(expected):
            raise ValueError()
        return files
    except (ValueError, TypeError, KeyError, AttributeError, tarfile.TarError, OSError, EOFError):
        raise Refused('Pinned public artifact refused') from None
