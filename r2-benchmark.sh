#!/bin/bash
cd $(dirname $0)
exec /home/rush/.local/share/nvm/v18.4.0/bin/node ./r2-benchmark.js $@