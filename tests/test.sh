#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail
set -o xtrace

revisions=${REVISIONS:-True}
remote=${REMOTE:-redirectory}

owner=thejohnfreeman
repo=zlib
tag=1.2.13
host=localhost

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

header() {
  set +o xtrace
  echo ================================================================== 1>&2
  echo $@ 1>&2
  echo ================================================================== 1>&2
  set -o xtrace
}

capture() {
  exec 2> >(tee ${output})
}

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

conan config set general.revisions_enabled=${revisions}
conan copy ${repo}/${tag}@ github/${owner} --all

conan user --remote ${remote} ${owner} --password $(cat github.token)

header RESET
capture
if ! ${remove} --remote ${remote}; then
  expect "ERROR: 404: Not Found."
else
  sleep 60
fi

header BUILD FROM SOURCE
${upload}
${remove}
sleep 60
capture
! ${install}
expect "ERROR: Missing prebuilt package for '${reference}'" \
  || expect "ERROR: ${reference} was not found in remote '${remote}'"
${install} --build missing
build

header BUILD FROM BINARY
${upload} --all
${remove}
sleep 60
${install}
build

header BUILD FROM SOURCE AGAIN
${remove} --remote ${remote} --packages
${remove}
sleep 60
capture
! ${install}
expect "ERROR: Missing prebuilt package for '${reference}'"
${install} --build missing
build

header RE-REMOVE
${remove} --remote ${remote}
conan copy ${reference} test/test --all --force
${remove}
sleep 60
capture
! ${install} --build missing
expect "ERROR: ${reference} was not found in remote '${remote}'"
capture
! ${remove} --remote ${remote}
expect "ERROR: 404: Not Found."

header RE-UPLOAD
conan copy ${repo}/${tag}@test/test github/${owner} --all
${upload} --all
sleep 60
${upload} --all

header UNAUTHENTICATED
conan user --clean
${remove}
${install}

header PASSED!
