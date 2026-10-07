# Approved leave attendance bridge

The approval transaction creates one queue job per date. The authenticated API
claims one job at a time. The Vultr process opens Chromium only for a claimed job,
uses the previously tested `session.json`, and verifies writes in a new context.

Deployment defaults are disabled. Set Vercel `AKC_KIOT_ATTENDANCE_WORKER_KEY` to
the generated local key and `KIOT_ATTENDANCE_SYNC_ENABLED=true` to allow claims.
Local `robot-config.json` additionally requires `write_enabled=true`. Keep it false
until setup and a preview have passed. Secrets stay on Vultr/Vercel, never in git.

Install using `bash install.sh FULL_COMMIT_SHA`. This preserves the existing
credentials and session, installs a disabled timer, and generates a private config
only if no config exists. `run.sh check` checks the API without claiming a job;
`run.sh setup` maps uniquely matched branch names and discovers attendance NV codes
for queued employees without claiming jobs or saving attendance. It checks the
CRM numeric ID against the Kiot user list, requires matching names and no duplicate
user names, then reads a unique exact-name NV option on the branch's timesheet.
Numeric Kiot invoice user IDs are not attendance NV codes. Discovered codes and
their source user IDs are cached locally; new employees are resolved automatically
when a job is processed. A changed source ID/name triggers a new lookup. Ambiguous
names, inactive accounts, missing options and cross-employee code collisions stop
the job before attendance is saved. Existing explicit mappings remain supported.

Use `worker.cjs preview /app/job.json` inside the Playwright container with a job
including CRM employee/branch context to check navigation without writing. After
verification, enable local writes and `systemctl enable --now akc-kiot-robot.timer`.
The timer checks once a minute; an empty queue never launches Chromium. The host
flock and fixed Docker name prevent overlapping local runs.

The robot skips dates without a shift after two independent reads. Existing
attendance or another leave status is a conflict, not an overwrite. An already
matching leave status is an idempotent success. Multiple shifts in a day and weeks
crossing a month boundary currently stop for manual review. Calendar arrow
navigation is guarded by exact modal date verification and still needs validation
against the live account. Do not enable all-staff unattended writes until staff
mappings and live preview checks are complete.

The queue migration was prepared separately. Confirm it is applied to Supabase
before enabling the API. Successful/cancelled history expires after 70 days;
failures remain for review, with at most five attempts and increasing backoff.

Checks: `node --test ops/kiot-robot/worker.test.cjs`, `npm run test:operations`,
and shell/JavaScript syntax checks. These do not establish live UI compatibility.
