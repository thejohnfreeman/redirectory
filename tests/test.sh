#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail
set -o xtrace

conan=${CONAN:-1}
revisions=${REVISIONS:-True}
remote=${REMOTE:-http://localhost}

owner=thejohnfreeman
repo=zlib
tag=0.1.0
host=localhost

reference=${repo}/${tag}@github/${owner}

# Preconditions
# =============
# 1. `github.token` exists in the current directory.
# 2. `oauth.json` exists in the current directory.

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
  conan install --remote redirectory ${root}
  cmake -DCMAKE_TOOLCHAIN_FILE=conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Release ${root}
  cmake --build .
  ./executable | tee ${output}
  expect 'answer? 42'
  popd
}

conan remote add redirectory ${remote}

if [ ${conan} -eq 1 ]; then
  conan config set general.revisions_enabled=${revisions}
  conan user --remote redirectory ${owner} --password $(cat github.token)
  logout="conan user --clean"
  export="conan create tests/packages/library github/${owner}"
  remove_all="conan remove --force ${reference}"
  remove_packages="${remove_all} --packages"
  upload_recipe="conan upload --remote redirectory ${reference}"
  upload_all="${upload_recipe} --all"
  install="conan install --remote redirectory ${reference}"
elif [ ${conan} -eq 2 ]; then
  conan profile detect
  # Cannot edit profile with Conan commands in Conan 2.
  conan remote login redirectory ${owner} --password $(cat github.token)
  logout="conan remote logout redirectory"
  export="conan create tests/packages/library --user github --channel ${owner}"
  remove_all="conan remove --confirm ${reference}"
  remove_packages="${remove_all}:*"
  upload_all="conan upload --remote redirectory --confirm ${reference}"
  upload_recipe="${upload_all} --only-recipe"
  install="conan install --remote redirectory --requires ${reference}"
else
  echo "unknown Conan version: ${conan}"
  exit 1
fi

header EXPORT TO CACHE
${export}
build

header RESET
if ! capture ${remove_all} --remote redirectory; then
  expect "ERROR: 404: Not Found."
else
  sleep 60
fi

header BUILD FROM SOURCE
${upload_recipe}
${remove_all}
sleep 60
! capture ${install}
expect "ERROR: Missing prebuilt package for '${reference}'" \
  || expect "ERROR: ${reference} was not found in remote 'redirectory'"
${install} --build missing
build

header BUILD FROM BINARY
${upload_all}
${remove_all}
sleep 60
${install}
build

header BUILD FROM SOURCE AGAIN
${remove_packages} --remote redirectory
${remove_all}
sleep 60
! capture ${install}
expect "ERROR: Missing prebuilt package for '${reference}'"
${install} --build missing
build

header RE-REMOVE
${remove_all} --remote redirectory
${remove_all}
sleep 60
! capture ${install} --build missing
expect "ERROR: ${reference} was not found in remote 'redirectory'" \
  || expect "ERROR: Package '${reference}' not resolved"
! capture ${remove_all} --remote redirectory
expect "ERROR: 404: Not Found."

header RE-UPLOAD
${export}
${upload_all}
sleep 60
${upload_all}

header UNAUTHENTICATED
${logout}
${remove_all}
${install}

header PASSED!
