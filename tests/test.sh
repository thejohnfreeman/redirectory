#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail

owner=thejohnfreeman
repo=zlib
tag=1.2.13
remote=redirectory

reference=${repo}/${tag}@github/${owner}

# Preconditions
# =============
# 1. Package ${repo}/${tag}@github/${owner} is built in the local cache.
# 2. Revisions are enabled or disabled.
# 3. `github.token` exists in the current directory.
# 4. Remote ${remote} is enabled.

upload="conan upload --remote ${remote} ${reference}"
install="conan install --remote ${remote} ${reference}"
remove="conan remove --force ${reference}"

expect() {
  grep --quiet "${1}" ${output}
}

build() {
  root="$(pwd)/tests/example"
  dir="$(mktemp -d)"
  trap "rm -rf ${dir}" RETURN
  pushd ${dir}
  conan install --remote ${remote} ${root}
  cmake -DCMAKE_TOOLCHAIN_FILE=conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Release ${root}
  cmake --build .
  ./main | tee ${output}
  expect 'hello, hello!'
  popd
}

output=$(mktemp)
trap "rm -f ${output}" EXIT

conan user --remote ${remote} ${owner} --password $(cat github.token)

echo ================================================================
echo RESET
echo ================================================================
${remove} --remote ${remote}

echo ================================================================
echo BUILD FROM SOURCE
echo ================================================================
${upload}
${remove}
sleep 1
exec 2> >(tee ${output})
! ${install}
expect "ERROR: Missing prebuilt package for '${reference}'"
# This means that the manifest was not yet available to download from GitHub:
# expect "ERROR: ${reference} was not found in remote '${remote}'"
${install} --build missing
build

echo ================================================================
echo BUILD FROM BINARY
echo ================================================================
${upload} --all
${remove}
sleep 1
${install}
build

echo ================================================================
echo BUILD FROM SOURCE AGAIN
echo ================================================================
${remove} --remote ${remote} --packages
${remove}
sleep 1
! ${install}
${install} --build missing
build

echo passed!
