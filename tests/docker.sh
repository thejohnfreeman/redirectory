#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

revisions=${REVISIONS:-True}
remote=${REMOTE:-redirectory}

image=b3607cc3d8ad

sudo docker run --rm --interactive --init \
--mount type=bind,source=$(pwd),target=/root/redirectory \
${image} <<EOF
apt install lsof
cd redirectory
conan remote add gcloud https://conan.jfreeman.dev --insert 1
PORT=80 VERBOSE=3 REVISIONS=${revisions} REMOTE=${remote} \
  ./tests/serve.sh ./tests/test.sh
EOF
