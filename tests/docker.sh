#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

image=b3607cc3d8ad

sudo docker run --rm --interactive --init \
--mount type=bind,source=$(pwd),target=/root/redirectory \
${image} <<EOF
apt install lsof
cd redirectory
PORT=80 VERBOSE=3 ./tests/serve.sh ./tests/test.sh
EOF
