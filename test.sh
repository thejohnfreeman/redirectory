set -o errexit
set -o nounset
set -o pipefail
set -o xtrace

conan user -r test thejohnfreeman -p $(cat github.token)
conan remove -f zlib/1.2.13@github/thejohnfreeman || true
conan copy zlib/1.2.13@ github/thejohnfreeman
conan remove -f zlib/1.2.13@github/thejohnfreeman -r test
conan upload zlib/1.2.13@github/thejohnfreeman -r test
conan remove -f zlib/1.2.13@github/thejohnfreeman
sleep 30
conan install zlib/1.2.13@github/thejohnfreeman -r test --build missing
