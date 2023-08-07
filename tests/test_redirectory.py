import pytest
import re
import subprocess as sp

def forgive(pattern, *args, **kwargs):
    try:
        sp.run(*args, capture_output=True, check=True, **kwargs)
    except sp.CalledProcessError as error:
        if not re.search(pattern, error.stderr.decode()):
            raise error

@pytest.fixture(scope='module', autouse=True)
def before_all():
    sp.check_call(
        ['gh', 'auth', 'login', '--with-token'],
        stdin=open('github.token', 'r'),
    )
    forgive(
        'release not found',
        ['gh', '--repo', 'thejohnfreeman/zlib', 'release', 'delete', '--cleanup-tag', '--yes', '1.2.13'],
    )
    sp.check_call(['conan', 'copy', 'zlib/1.2.13@', 'github/thejohnfreeman'])
    with open('github.token', 'r') as password:
        sp.check_call(
            ['conan', 'user', '--remote', 'local', 'thejohnfreeman', '--password', password]
        )
    sp.check_call(['conan', 'remote', 'disable', 'conancenter'])
    sp.check_call(
        ['gh', '--repo', 'thejohnfreeman/zlib', 'release', 'create', '--notes', ''],
    )

def test_hello():
    print('hello')
    assert True

def test_goodbye():
    print('goodbye')
    assert True
