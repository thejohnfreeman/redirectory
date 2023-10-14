#!/usr/bin/env bash

# Job control is disabled by default for non-interactive shells.
# Background jobs are not started in their own process group
# unless job control is enabled.
# We need a separate process group for NPM
# to kill the server without killing this shell.
# Turn it on.
set -o monitor

if [ $# -lt 1 ]; then
  echo 'missing command'
  exit 1
fi

PORT=${PORT:-9595}

PORT=${PORT} npm start >server.log 2>&1 &
pid=$!
# Echo to strip whitespace.
gid=$(echo $(ps -o pgid= ${pid}))

port() {
  lsof -g ${gid} -a -i:${PORT}
}

# Need to give it time to start up.
while ! port; do
  sleep 0.5
done

"$@"

# NPM starts the server in a child process
# but does not correctly propagate signals to children.
# https://github.com/npm/cli/issues/6684
# TODO: Does SIGTERM suffice?
kill -KILL -- -${gid}

wait ${pid}
port && echo 'PORT NOT RELEASED!'
