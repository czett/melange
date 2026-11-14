# melange

**melange** is an ultra-fast 60fps Linux Live-TV, media, and couch-launcher system written in Rust.

## Workspace Layout

```text
melange/
├── core/                 # melange-core: config, sqlite, m3u/xmltv, input router, rodio audio, player controller, axum http/ws server
├── shell/                # melange-shell: gtk4 overlay window (libmpv glarea + transparent webkit6 webview)
├── ui/                   # melange-ui: stateless solidjs + typescript + tailwind glassmorphism frontend
├── scripts/
│   └── seed_dev.sh       # zero-hardware dev fixture generator
├── assets/
│   └── sounds/           # preloaded wav ui feedback samples
├── justfile              # task runner recipes
├── ARCHITECTURE.md       # architectural decisions and constraints
└── README.md
```

## System Dependencies

On Linux (Debian/Ubuntu/Fedora/Arch equivalents):

- `libmpv-dev` (libmpv 2.x)
- `libgtk-4-dev` (GTK 4)
- `libwebkitgtk-6.0-dev` (WebKitGTK 6.0 for transparent overlay)
- `libudev-dev` (for `gilrs` gamepad discovery)
- `libasound2-dev` (ALSA headers for `rodio` / PipeWire)
- `nodejs` & `npm` (for building `ui/` into `ui/dist`)
- Optional: `ffmpeg`, `python3`, `just`

## Quick Start (`--dev` mode)

1. Seed the local `dev/` environment (creates `dev/channels.m3u`, `dev/epg.xml`, `dev/media/*.mp4`, and `assets/sounds/*.wav`):

   ```bash
   ./scripts/seed_dev.sh
   # or: just seed
   ```

2. Build the SolidJS frontend (`ui/dist`):

   ```bash
   cd ui && npm install && npm run build
   # or: just ui-build
   ```

3. Run `melange-shell` in `--dev` mode:

   ```bash
   cargo run -p melange-shell -- --dev
   # or: just dev
   ```

## CLI Flags

- `--dev`: Resolve database and media fixtures relative to `./dev/` (`dev/melange.db`, `dev/channels.m3u`, `dev/epg.xml`), open a `1280x720` window, and auto-tune channel 1 on startup.
- `--desktop`: Standard windowed desktop mode (`1280x720`).
- `--kiosk`: Borderless fullscreen mode with hidden cursor and disabled WebKit context menus for living-room / couch setups.
- `--port <N>` (or `MELANGE_PORT=<N>`): Override the `axum` HTTP/WebSocket server port (default `9000`).

## Tests & Linting

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd ui && npm run typecheck && npm run build
```
