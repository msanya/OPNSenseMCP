# msanya/OPNSenseMCP — hardening fork

Fork of [vespo92/OPNSenseMCP](https://github.com/vespo92/OPNSenseMCP) at `c2313b49`, used read-only by a homelab
admin agent. Branch `m3gan/readonly-hardening`. Changes against upstream:

| Area | Upstream behaviour | This fork |
|---|---|---|
| Read-only mode | `ssh_*` / `cli_*` stay listed; their per-command check anchors only the start, so `cat x; reboot` passes | `ssh_*`, `cli_*`, `macro_*` and `configure` are hidden and refused under `OPNSENSE_READ_ONLY=true` |
| SSH | Always armed: user `root`, key `~/.ssh/id_rsa`, no host-key check | Opt-in: nothing connects unless `OPNSENSE_SSH_ENABLED=true`; no implicit key; `ssh_*`, `cli_*`, `nat_*` hidden while disabled |
| Shell chaining | `; & \| $( ) \` > <` and newlines reach the remote shell | Rejected in the read-only command check and at the `ssh_execute` / `ssh_batch_execute` / `cli_execute` tool boundary |
| Read-only API | Every POST blocked, including `search*` reads such as DHCP leases | POST `search*` / `get*` actions pass; all other mutations stay blocked |
| DHCP leases | Only the legacy ISC endpoint — 0 leases on a Kea/dnsmasq router | Reads Kea, dnsmasq and ISC, merged by MAC (latest expiry wins), each lease tagged with `source` |
| Backups | `list_backups` returns a fake entry; `create_backup` saves nothing; `restore_backup` uploads `<opnsense>mock config data</opnsense>`; output on stdout | Built on the router's own configuration history: `list_backups`, new `diff_backups`, `create_backup` keeps a local 0600 copy, `restore_backup` calls `core/backup/revertBackup/<id>` for an entry the router already holds |

Still upstream behaviour (fix before enabling writes): NAT writes rewrite `/conf/config.xml` over SSH with
`ignoreAttrs` (drops XML attributes); SSH host keys are not verified; the IaC engine's create/update/delete are stubs.

Build: `bun install --frozen-lockfile --ignore-scripts && npx tsc && npx vitest run` (133 tests).
