#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

image=d6a1f2611951

sudo docker run --rm -i \
--mount type=bind,source=$(pwd),target=/root/redirectory,readonly \
${image} <<EOF
cd redirectory
PORT=80 npm start &
sleep 2
# Do not cache anything. Tests are run once and then discarded.
# Stop after the first failure.
pytest -p no:cacheprovider -x "$@"
EOF
