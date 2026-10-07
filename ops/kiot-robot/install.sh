#!/usr/bin/env bash
set -euo pipefail
robot_ref="${1:?Pass the reviewed commit SHA}"
[[ "$robot_ref" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA'; exit 1; }
robot_dir=/home/akc-kiot-robot
test -f "$robot_dir/session.json" || { echo 'Thieu session.json. Chua thay doi cau hinh.'; exit 1; }
install -d -m 700 "$robot_dir"
robot_stage=$(mktemp -d)
trap 'rm -rf "$robot_stage"' EXIT
for robot_file in worker.cjs attendance.cjs setup.cjs run.sh; do
  curl --fail --silent --show-error --location --max-time 45 \
    "https://raw.githubusercontent.com/akc-crm/akc-crm-/$robot_ref/ops/kiot-robot/$robot_file" \
    -o "$robot_stage/$robot_file"
done
for robot_file in worker.cjs attendance.cjs setup.cjs run.sh; do
  install -m 600 "$robot_stage/$robot_file" "$robot_dir/$robot_file"
done
chmod 700 "$robot_dir/run.sh"
if ! test -f "$robot_dir/robot-config.json"; then
  python3 - <<'PY'
import json, secrets, os
p='/home/akc-kiot-robot/robot-config.json'
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:
    json.dump({'crm_url':'https://crm.kickfits.info','worker_key':secrets.token_hex(32),
               'write_enabled':False,'staff_codes':{},'branch_names':{}},f,ensure_ascii=False,indent=2)
print('Da tao khoa rieng; che do ghi dang tat.')
PY
fi
cat > /etc/systemd/system/akc-kiot-robot.service <<'UNIT'
[Unit]
Description=AKC approved leave to Kiot attendance
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/home/akc-kiot-robot/run.sh run
TimeoutStartSec=540
UNIT
cat > /etc/systemd/system/akc-kiot-robot.timer <<'UNIT'
[Unit]
Description=Check approved leave queue every minute
[Timer]
OnBootSec=60
OnUnitInactiveSec=60
Unit=akc-kiot-robot.service
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
echo 'DA CAI BO NOI; CHUA BAT GHI; CHUA BAT TIMER.'
echo 'Chay run.sh check sau khi cau hinh khoa tren CRM.'
