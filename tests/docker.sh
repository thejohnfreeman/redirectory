#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

revisions=${REVISIONS:-True}
remote=${REMOTE:-redirectory}
image=${IMAGE:-6f5a5f5cb0d7}

test=${1:-./tests/test.sh}

sudo docker run --rm --interactive \
--mount type=bind,source=$(pwd),target=/root/redirectory \
${image} <<EOF
cd redirectory
PORT=80 VERBOSE=3 REVISIONS=${revisions} REMOTE=${remote} \
  ./tests/serve.sh ${test}
EOF
