# app-server

Local control daemon for the Minenet CLI.

## Run

```bash
bun install
bun run index.ts
```

The daemon binds to `127.0.0.1` on a random port and writes connection metadata to the local Minenet config directory.

## Responsibilities

- Device-code login handshake relay (`/api/cli/v1/device/*`)
- Local token/profile persistence
- Workspace pull/push conflict detection and manifest management
- Deploy run queueing + run status proxying
