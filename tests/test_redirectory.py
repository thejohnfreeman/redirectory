import contextlib
import http.client
import io
import json
import os
import pathlib
import pytest
import re
import shush
from shush.pytest import cap, forgive
import subprocess as sp
import tempfile

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

    def remove(self, remote=False, packages=False):
        return sh> sh.conan(
            'remove',
            remote and ['--remote', 'local'],
            '--force',
            f'{self.package}/{self.version}@github/{self.owner}',
            packages and '--packages',
        )

    def upload(self, all=False):
        return sh> sh.conan('upload', '--remote', 'local', self.reference, all and '--all')

    def install(self, build=False):
        sh> sh.conan('install', '--remote', 'local', self.reference, build and ['--build', 'missing'])

    def build(self):
        root = pathlib.Path().resolve() / 'tests' / 'example'
        with tempfile.TemporaryDirectory() as cwd:
            sh_ = sh(cwd=cwd)
            sh_> sh_.conan('install', '--remote', 'local', root)
            sh_> sh_.cmake('-DCMAKE_TOOLCHAIN_FILE=conan_toolchain.cmake', '-DCMAKE_BUILD_TYPE=Release', root)
            sh_> sh_.cmake('--build', '.')
            proc = sh_.here> sh_['./main']
            assert(proc.stdout == b'hello, hello!\n')

@pytest.fixture(scope='module')
def ctx():
    return Context('zlib', '1.2.13', 'thejohnfreeman')

@pytest.fixture(scope='module', autouse=True)
def before_all(ctx):
    # sh> (sh.gh('auth', 'login', '--with-token') < ctx.token)
    # with forgive(cap.err.matches('release not found')):
    #     sh> sh.gh('release', 'delete', ctx.version, '--cleanup-tag', '--yes', repo=f'{ctx.owner}/{ctx.package}')
    sh> sh.conan('copy', f'{ctx.package}/{ctx.version}@', f'github/{ctx.owner}')
    sh> sh.conan('remote', 'disable', 'conancenter')
    sh> sh.conan('config', 'set', 'general.revisions_enabled=True')
    sh> sh.conan('user', ctx.owner, '--remote', 'local', '--password', ctx.token)

def test_source(ctx, cap):
    with forgive(cap.err.matches('ERROR: 404: Not Found.')):
        ctx.remove(remote=True)
    ctx.upload()
    ctx.remove()
    with forgive(cap.err.matches('ERROR: Missing prebuilt package')
                 | cap.err.matches('was not found in remote')):
        ctx.install()
    ctx.install(build=True)
    ctx.build()

def test_binary(ctx, cap):
    ctx.upload(all=True)
    ctx.remove()
    ctx.install()
    ctx.build()
    ctx.remove(remote=True, packages=True)
    ctx.remove()
    with forgive(cap.err.matches('ERROR: Missing prebuilt package')):
        ctx.install()
    ctx.install(build=True)
    ctx.build()

def test_reupload(ctx, cap):
    ctx.remove(remote=True)
    ctx.remove()
    with forgive(cap.err.matches('was not found in remote')):
        ctx.install()
    with forgive(cap.err.matches('ERROR: 404: Not Found.')):
        ctx.remove(remote=True)
    ctx.upload(all=True)
    ctx.upload()
    ctx.upload(all=True)
    sh> sh.conan('user', '--clean')
    ctx.remove()
    ctx.install()
