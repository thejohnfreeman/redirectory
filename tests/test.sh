#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail
set -o xtrace

owner=thejohnfreeman
repo=zlib
tag=1.2.13
remote=redirectory
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

wait_for() {
  status=${2:-200}
  json=$(mktemp)
  trap "rm -f ${json}" RETURN
  tries=0
  while ! curl --location --include ${1} | grep --quiet "HTTP/2 ${status}"; do
      let "tries = ${tries} + 1"
      [ ${tries} -lt 30 ] || exit 1
      sleep 1
  done
}

output=$(mktemp)
trap "rm -f ${output}" EXIT

# conan info ${reference} --json ${output}
file=~/.conan/data/${repo}/${tag}/github/${owner}/metadata.json
pkgid=$(<${file} jq --raw-output '.packages | keys[0]')
prev=$(<${file} jq --raw-output ".packages[\"${pkgid}\"].revision")
rrev=$(<${file} jq --raw-output ".packages[\"${pkgid}\"].recipe_revision")

base_url=http://${host}/v2/conans/${repo}/${tag}/github/${owner}
source_manifest=${base_url}/revisions/${rrev}/files/conanmanifest.txt
binary_manifest=${base_url}/revisions/${rrev}/packages/${pkgid}/revisions/${prev}/files/conanmanifest.txt

conan user --remote ${remote} ${owner} --password $(cat github.token)

header RESET
capture
if ! ${remove} --remote ${remote}; then
  expect "ERROR: 404: Not Found."
fi
wait_for ${source_manifest} 404
sleep 1
wait_for ${source_manifest} 404

header BUILD FROM SOURCE
${upload}
${remove}
wait_for ${source_manifest}
sleep 1
wait_for ${source_manifest}
capture
! ${install}
expect "ERROR: Missing prebuilt package for '${reference}'" \
  || expect "ERROR: ${reference} was not found in remote '${remote}'"
${install} --build missing
build

header BUILD FROM BINARY
${upload} --all
${remove}
wait_for ${binary_manifest}
sleep 1
wait_for ${binary_manifest}
${install}
build

header BUILD FROM SOURCE AGAIN
${remove} --remote ${remote} --packages
${remove}
wait_for ${source_manifest}
sleep 1
wait_for ${source_manifest}
capture
! ${install}
expect "ERROR: Missing prebuilt package for '${reference}'"
${install} --build missing
build

header RE-REMOVE
${remove} --remote ${remote}
conan copy ${reference} test/test --all --force
${remove}
capture
! ${install} --build missing
expect "ERROR: ${reference} was not found in remote '${remote}'"
capture
! ${remove} --remote ${remote}
expect "ERROR: 404: Not Found."

header RE-UPLOAD
conan copy ${repo}/${tag}@test/test github/${owner} --all
${upload} --all
${upload}
${upload} --all
# TODO: Use default token for read-only commands.
# conan user --clean
# ${remove}
# ${install}

header PASSED!
