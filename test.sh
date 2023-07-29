set -o errexit
set -o nounset
set -o pipefail
set -o xtrace

remote=${REMOTE:-express}

conan user -r ${remote} thejohnfreeman -p $(cat github.token)
conan remove -f zlib/1.2.13@github/thejohnfreeman || true
conan copy zlib/1.2.13@ github/thejohnfreeman
conan remove -f zlib/1.2.13@github/thejohnfreeman -r ${remote}
conan upload zlib/1.2.13@github/thejohnfreeman -r ${remote}
conan remove -f zlib/1.2.13@github/thejohnfreeman
sleep 40
conan install zlib/1.2.13@github/thejohnfreeman -r ${remote} --build missing
