#!/usr/bin/env bash
set -euo pipefail
robot_mode="${1:-check}"
[[ "$robot_mode" == check || "$robot_mode" == setup || "$robot_mode" == run ]] || exit 2
exec 9>/home/akc-kiot-robot/worker.lock
flock -n 9 || { echo 'ROBOT DANG CHAY; BO QUA LAN GOI TRUNG.'; exit 0; }
robot_script=worker.cjs
[[ "$robot_mode" != setup ]] || robot_script=setup.cjs
exec docker run --rm --name akc-kiot-attendance --memory=768m --cpus=0.75 --shm-size=128m \
  -v /home/akc-kiot-robot:/app -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble node "$robot_script" "$robot_mode"
