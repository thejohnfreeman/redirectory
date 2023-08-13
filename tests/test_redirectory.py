import contextlib
import http.client
import io
import json
import os
import pathlib
import pytest
import re
import shush
import subprocess as sp
import tempfile

# TODO: Split into ecosystem of composable matchers.
def stdout_matches(pattern):
    def matcher(error):
        return re.search(pattern, error.stdout.decode())
    return matcher

@contextlib.contextmanager
def forgive(matcher):
    try:
        yield
    except Exception as error:
        if not matcher(error):
            raise error

sh = shush.Shell()

class Context:
    def __init__(self, package, version, owner):
        self.package = package
        self.version = version
        self.owner = owner
        self.reference = f'{package}/{version}@github/{owner}'
        self.token = pathlib.Path('github.token').read_bytes().strip()

    def create_ref(self, ref, sha):
        conn = http.client.HTTPSConnection('api.github.com')
        conn.request(
            'POST', f'/repos/{self.owner}/{self.package}/git/refs',
            headers={
                'User-Agent': 'Python 3.10 http.client',
                'Accept': 'application/vnd.github+json',
                'Authorization': f'Bearer {self.token.decode()}',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            body=json.dumps({ 'ref': ref, 'sha': sha }).encode(),
        )
        response = conn.getresponse()
        assert(response.status == 201)
        conn.close()

    def upload(self, all=False):
        return sh> sh.conan('upload', self.reference, all and '--all', '--remote', 'local')

    def install(self, build=False):
        root = pathlib.Path().resolve() / 'tests' / 'example'
        with tempfile.TemporaryDirectory() as cwd:
            sh_ = sh(cwd=cwd)
            sh_> sh_.conan('install', root, build and ['--build', 'missing'])
            sh_> sh_.cmake('-DCMAKE_TOOLCHAIN_FILE=conan_toolchain.cmake', '-DCMAKE_BUILD_TYPE=Release', root)
            sh_> sh_.cmake('--build', '.')
            proc = sh_.here> sh_['./main']
            assert(proc.stdout == b'hello, hello!\n')

@pytest.fixture(scope='module')
def ctx():
    return Context('zlib', '1.2.13', 'thejohnfreeman')

@pytest.fixture(scope='module', autouse=True)
def before_all(ctx):
    sh> (sh.gh('auth', 'login', '--with-token') < ctx.token)
    with forgive(stdout_matches('release not found')):
        sh.here> sh.gh('release', 'delete', ctx.version, '--cleanup-tag', '--yes', repo=f'{ctx.owner}/{ctx.package}').join()
    sh> sh.conan('copy', f'{ctx.package}/{ctx.version}@', f'github/{ctx.owner}')
    sh> sh.conan('remote', 'disable', 'conancenter')
    sh> sh.conan('config', 'set', 'general.revisions_enabled=True')
    sh> sh.conan('user', ctx.owner, '--remote', 'local', '--password', ctx.token)

def test_hello(ctx):
    ctx.upload()
    with pytest.raises(sp.CalledProcessError) as error:
        ctx.install()
    import pprint
    pprint.pprint(error)
    ctx.install(build=True)
