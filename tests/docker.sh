#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

image=c342b8f5f65a

sudo docker run --rm -i \
--mount type=bind,source=$(pwd),target=/root/redirectory \
${image} <<EOF
pip3 install --upgrade shush
conan config set general.retry=0
conan config set general.retry_wait=0
conan config set general.revisions_enabled=True
conan copy zlib/1.2.13@ github/thejohnfreeman
conan remote rename local redirectory
conan remote disable conancenter
cd redirectory
PORT=80 VERBOSITY=3 npm start >redirectory.server.log 2>&1 &
sleep 2
./tests/test.sh
EOF
