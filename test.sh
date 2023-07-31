#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail
set -o xtrace

remote=${REMOTE:-express}

references=$(
cat <<EOF
cupcake/0.2.0@vgithub/thejohnfreeman
zlib/1.2.13@github/thejohnfreeman
EOF
)

for reference in ${references}; do
  IFS=@ read nv uc <<<${reference}
  conan user -r ${remote} thejohnfreeman -p $(cat github.token)
  conan remove -f ${nv}@${uc} || true
  conan copy ${nv}@ ${uc}
  conan remove -f ${nv}@${uc} -r ${remote}
  conan upload ${nv}@${uc} -r ${remote}
  conan remove -f ${nv}@${uc}
  command="conan install ${nv}@${uc} -r ${remote} --build missing"
  ${command} || (sleep 90 && ${command})
done
