# melange architecture

## Core Architecture Constraints

1. **Single-Window Embedded `libmpv`:**
   `libmpv` renders directly into the OpenGL context of a `gtk4::GLArea` inside `melange-shell` (`vo=libmpv`, `hwdec=auto-safe`, `keep-open=always`, `idle=yes`). No external `mpv` process is ever spawned.

2. **Zero-Black-Screen Zapping:**
   `libmpv` stays permanently initialized in memory. Channel switches issue `loadfile <url> replace`, keeping the last decoded frame of the previous channel frozen on screen until the new stream renders its first keyframe.

3. **Native Zero-Latency Audio:**
   `melange-core` preloads WAV samples from `assets/sounds/` into `Arc<Vec<u8>>` at startup and plays them via `rodio` (PipeWire / `pipewire-pulse` compatible) on `NavEvent`s, completely decoupled from any browser audio context.

4. **Graceful Degradation:**
   Missing hardware (no DualShock 4 connected, no `evdev`/`cec` devices, or headless audio environments in CI) never crashes or blocks startup.

## Crate Responsibilities

### `melange-core` (`core/`)
- **CLI & Config (`config.rs`):** Parses `--dev`, `--desktop`, and `--kiosk` modes and resolves database, playlist, EPG, and sound asset paths.
- **SQLite Persistence (`db.rs`):** `rusqlite` (bundled) managing `profiles`, `channels`, `epg_cache`, and `watch_history` with idempotent migrations and default profile seeding.
- **M3U & XMLTV Provider (`provider.rs`):** `M3uXmltvProvider` parses `#EXTM3U` playlists and XMLTV `<channel>` / `<programme>` feeds and upserts them into SQLite.
- **Unified Input Router (`input.rs`):** `NavEvent` enum (`Up`, `Down`, `Left`, `Right`, `Select`, `Back`, `Home`, `ChannelUp`, `ChannelDown`, `ToggleEpg`, `Digit(u8)`) fed by keyboard and a background `gilrs` DualShock 4 thread (with 180ms repeat debounce on D-Pad/Left Stick).
- **Audio Feedback (`audio.rs`):** Preloaded in-memory WAV playback via `rodio`.
- **Player Controller (`player.rs`):** Channel zapping state machine (`Idle`, `Buffering`, `Playing`, `Paused`, `is_zapping`), wrap-around `channel_up` / `channel_down`, multi-digit `zap_digit`, and `PlayerBackend` trait decoupled from `libmpv` FFI for unit testing.

### `melange-shell` (`shell/`)
- **GTK4 Application (`main.rs`):** `gtk4::Application` (`org.melange.tv`) handling `--dev`, `--desktop`, and `--kiosk`.
- **Embedded OpenGL Video (`mpv_gl.rs`):** `gtk4::GLArea` wired to `libmpv2::render::RenderContext` using `libepoxy.so.0` (`epoxy_get_proc_address`) and `glib::idle_add_once` / `MainContext::invoke` for thread-safe `queue_render()` callbacks.
- **Input Forwarding:** Maps GTK4 keyboard events (`Up`, `Down`, `Left`, `Right`, `Return`, `Escape`, `Page_Up`, `Page_Down`, `0`–`9`, `h`/`H`, `e`/`E`) and `gilrs` gamepad events into `melange-core`'s `NavEvent` router.
