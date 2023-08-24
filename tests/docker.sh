#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail

revisions=${1:-True}

image=b3607cc3d8ad

sudo docker run --rm -i \
--mount type=bind,source=$(pwd),target=/root/redirectory \
${image} <<EOF
conan config set general.revisions_enabled=${revisions}
conan copy zlib/1.2.13@ github/thejohnfreeman --all
cd redirectory
PORT=80 VERBOSITY=3 npm start >redirectory.server.log 2>&1 &
tcpdump -i any -U -w redirectory.pcap tcp &
sleep 1
./tests/test.sh
EOF
