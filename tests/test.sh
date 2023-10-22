#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail
set -o xtrace

conan=${CONAN:-1}
revisions=${REVISIONS:-True}
remote=${REMOTE:-redirectory}

owner=thejohnfreeman
repo=zlib
tag=0.1.0
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

output=$(mktemp)
trap "rm -f ${output}" EXIT

# We only need to capture stderr.
capture() {
  set +o xtrace
  exec 4>&2 2> >(tee ${output})
  "$@"
  exec 2>&4
  set -o xtrace
}

expect() {
  grep --quiet "${1}" ${output}
}

build() {
  root="$(pwd)/tests/packages/executable"
  dir="$(mktemp -d)"
  trap "rm -rf ${dir}" RETURN
  pushd ${dir}
  conan install --remote ${remote} ${root}
  cmake -DCMAKE_TOOLCHAIN_FILE=conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Release ${root}
  cmake --build .
  ./executable | tee ${output}
  expect 'answer? 42'
  popd
}

conan config set general.revisions_enabled=${revisions}
conan user --remote ${remote} ${owner} --password $(cat github.token)

header EXPORT TO CACHE
conan create tests/packages/library
build

header RESET
if ! capture ${remove} --remote ${remote}; then
  expect "ERROR: 404: Not Found."
else
  sleep 60
fi

header BUILD FROM SOURCE
${upload}
${remove}
sleep 60
! capture ${install}
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
! capture ${install}
expect "ERROR: Missing prebuilt package for '${reference}'"
${install} --build missing
build

header RE-REMOVE
${remove} --remote ${remote}
${remove}
sleep 60
! capture ${install} --build missing
expect "ERROR: ${reference} was not found in remote '${remote}'"
! capture ${remove} --remote ${remote}
expect "ERROR: 404: Not Found."

header RE-UPLOAD
conan create tests/packages/library
${upload} --all
sleep 60
${upload} --all

header UNAUTHENTICATED
conan user --clean
${remove}
${install}

header PASSED!
