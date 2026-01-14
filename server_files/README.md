# Server Files

This directory contains master copies of files to deploy to remote ISync servers.

## Structure

```
server_files/
├── rclone/          # rclone binary and config
│   ├── rclone       # rclone executable (optional)
│   └── rclone.conf  # master rclone configuration
├── keys/            # Service account JSON files
│   └── *.json
├── batch/           # Batch command scripts
│   └── *.sh
├── cron/            # Crontab files
│   ├── default.crontab              # Default crontab for all servers
│   └── server_specific/             # Per-server overrides
│       └── {server_id}.crontab
└── scripts/         # Helper scripts for remote servers
    └── isync_runner.sh
```

## Usage

1. Place your master rclone.conf in `rclone/`
2. Copy your service account JSON files to `keys/`
3. Save batch scripts to `batch/`
4. Create crontab templates in `cron/`
5. Use the ISync Orchestrator UI to deploy to remote servers

## Deployment

Files from this directory are pushed to remote servers via the **Remote Servers** page in ISync.
The orchestrator will sync these files to the configured `remote_path` on each server.
