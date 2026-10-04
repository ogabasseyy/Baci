import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tarfile


ROUTES = {
    '/_not-found/page', '/_global-error/page', '/api/csrf/route',
    '/api/storefront/customer/savings/card-checkout/route', '/savings/card-return/page',
}


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(65536), b''):
            value.update(chunk)
    return value.hexdigest()


def package(web, launcher, output):
    web, launcher, output = Path(web), Path(launcher), Path(output)
    standalone = web / '.next/standalone'
    static = web / '.next/static'
    if standalone.is_symlink() or static.is_symlink() or launcher.is_symlink():
        raise ValueError('Artifact roots cannot be symlinks')
    routes = json.loads((standalone / 'apps/web/.next/server/app-paths-manifest.json').read_bytes())
    if set(routes) != ROUTES or not (standalone / 'apps/web/server.js').is_file():
        raise ValueError('Compiled checkout routes differ')
    for directory in (standalone, static):
        for entry in directory.rglob('*'):
            if entry.name == '.env' or entry.name.startswith('.env.'):
                raise ValueError('Environment file in release')
            if entry.is_symlink() and not entry.resolve().is_relative_to(directory.resolve()):
                raise ValueError('Artifact symlink escapes release')
            if not entry.is_dir() and not entry.is_file():
                raise ValueError('Artifact has unsupported entry')
    output.mkdir(mode=0o700)
    tree = output / 'app'
    shutil.copytree(standalone, tree, symlinks=False)
    shutil.copytree(static, tree / 'apps/web/.next/static')
    shutil.copyfile(launcher, tree / 'launch-public.cjs')
    entries = []
    for entry in sorted(tree.rglob('*')):
        if entry.is_file():
            content_size = entry.stat().st_size
            if content_size > 64_000_000:
                raise ValueError('Oversized artifact file')
            if entry.suffix in ('.js', '.cjs', '.json') and b'FIRST_CARD_BUILD_SENTINEL_NOT_RUNTIME' in entry.read_bytes():
                raise ValueError('Synthetic build configuration entered runtime')
            entry.chmod(0o444)
            entries.append(dict(path=entry.relative_to(tree).as_posix(), size=content_size, sha256=digest(entry)))
        elif entry.is_dir():
            entry.chmod(0o555)
        else:
            raise ValueError('Packaged artifact is not regular')
    tree.chmod(0o555)
    total = sum(entry['size'] for entry in entries)
    if len(entries) > 40000 or total > 400_000_000:
        raise ValueError('Artifact size limit exceeded')
    tarball = output / 'public-app.tar.gz'
    with tarfile.open(tarball, 'w:gz', format=tarfile.PAX_FORMAT) as archive:
        for entry in entries:
            source = tree / entry['path']
            info = archive.gettarinfo(str(source), arcname=entry['path'])
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            info.mode = 0o444
            with source.open('rb') as handle:
                archive.addfile(info, handle)
    report = dict(version=1, count=len(entries), bytes=total, files=entries,
                  tarballSha256=digest(tarball), tarballSize=tarball.stat().st_size)
    (output / 'public-app.manifest.json').write_text(json.dumps(report, sort_keys=True))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--web', required=True)
    parser.add_argument('--launcher', required=True)
    parser.add_argument('--output', required=True)
    arguments = parser.parse_args()
    result = package(arguments.web, arguments.launcher, arguments.output)
    print(json.dumps({key: result[key] for key in ('count', 'bytes', 'tarballSha256', 'tarballSize')}))
