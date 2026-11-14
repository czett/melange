# melange

**melange** is an ultra-fast 60fps Linux Live-TV, media, and couch-launcher system written in Rust.

## Workspace Layout

```text
melange/
├── core/                 # melange-core: config, sqlite, m3u/xmltv, input router, rodio audio, player controller, axum http/ws server
├── shell/                # melange-shell: gtk4 overlay window (libmpv glarea + transparent webkit6 webview)
├── ui/                   # melange-ui: stateless solidjs + typescript + tailwind crimson fluted-glass frontend
├── companion/            # melange-companion: mobile remote/channel/profile pwa in crimson fluted-glass
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


## Milestone 4: Living-Room Hardware & QR Smartphone Companion

### Hardware Adapters
- **Tvheadend (`MELANGE_TVHEADEND_URL`)**: Optional `MELANGE_TVHEADEND_USER` and `MELANGE_TVHEADEND_PASS`. Fetches `/api/channel/grid?limit=500` and `/api/epg/events/grid?limit=2000`, falling back to M3U/XMLTV if unconfigured or unreachable.
- **2.4GHz USB Remote (`evdev`)**: Automatically scans `/dev/input/event*` for USB HID remote/consumer devices and maps media/navigation keys to `NavEvent`, degrading gracefully on `PermissionDenied`.
- **HDMI-CEC (`--features cec`)**: Optional Cargo feature (`cargo run -p melange-shell --features cec`) so default laptop builds do not require `libcec-dev`.

### Smartphone Companion (`/companion`)
- Open **Settings** in `melange-ui` to scan the offline-generated QR code for `http://<LAN-IP>:9000/companion`.
- Includes **Remote** (D-Pad, Ch+/Ch-, EPG, Play/Pause, 0-9), **Channels** (reorder & favorites), and **Profiles** (create, rename, upload custom wallpaper).


## Milestone 5: Kiosk Appliance Packaging & Deployment

### Single-Binary Release Bundle
`melange-shell` embeds `ui/dist`, `companion/dist`, and `assets/sounds` directly via `rust-embed` (`core/src/assets.rs`). In `--dev` mode, live disk files are preferred when present for rapid frontend iteration; in `--kiosk` / `--desktop` mode, the binary runs standalone anywhere.

Build the release tarball (`dist/melange-kiosk-linux-x86_64.tar.gz`):

```bash
just package-release
```

### Appliance Provisioning (`cage` + `systemd` + PipeWire + WireGuard)
1. Extract `melange-kiosk-linux-x86_64.tar.gz` on a minimal Debian, Ubuntu, or Arch Linux host with `cage`, `pipewire`, `pipewire-pulse`, and `wireplumber` installed.
2. Run the idempotent provisioning script as root:
   ```bash
   sudo ./deploy/setup-appliance.sh
   ```
   This creates the `melange` system user (`video`, `render`, `input`, `audio`), installs `deploy/99-melange-input.rules` for DualShock 4 / 2.4GHz remotes / `/dev/cec*`, enables `loginctl enable-linger melange` for PipeWire, installs `/usr/local/bin/melange-shell` and `/etc/melange/melange.toml`, and enables `melange-kiosk.service`.
3. (Optional) Configure `deploy/wg0.conf.template` at `/etc/wireguard/wg0.conf` for remote SSH maintenance.
4. Start the kiosk:
   ```bash
   sudo systemctl start melange-kiosk.service
   ```
