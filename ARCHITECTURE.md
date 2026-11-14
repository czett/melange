# melange architecture

## Core Architecture Constraints

1. **Single-Window Multi-Layer Compositing:**
   `melange-shell` uses a `gtk4::Overlay` inside a single `gtk4::ApplicationWindow`:
   - **Base layer:** `gtk4::GLArea` rendering `libmpv` directly via OpenGL (`vo=libmpv`, `hwdec=auto-safe`, `keep-open=always`, `idle=yes`). No external `mpv` process is ever spawned.
   - **Overlay layer:** `webkit6::WebView` with a transparent RGBA background (`RGBA(0.0, 0.0, 0.0, 0.0)`) so live video shows through and CSS `backdrop-filter: blur(...)` blurs the live video frame in real time.

2. **Strict UI Decoupling:**
   `melange-ui` (`ui/`) is a stateless SolidJS + TypeScript + Tailwind CSS frontend. All authoritative application state lives in `melange-core` (`StateManager`) and is synced over WebSocket (`ws://127.0.0.1:9000/ws`) and REST (`/api/*`).

3. **Zero-Black-Screen Zapping:**
   `libmpv` stays permanently initialized in memory. Channel switches issue `loadfile <url> replace`, keeping the last decoded frame of the previous channel frozen on screen until the new stream renders its first keyframe.

4. **Native Zero-Latency Audio:**
   `melange-core` preloads WAV samples from `assets/sounds/` into `Arc<Vec<u8>>` at startup and plays them via `rodio` (PipeWire / `pipewire-pulse` compatible) on `NavEvent`s, completely decoupled from any browser audio context.

5. **60fps Gamepad & Keyboard Spatial Navigation:**
   Users control the UI via `NavEvent`s (`Up`, `Down`, `Left`, `Right`, `Select`, `Back`, `Home`, `ChannelUp`, `ChannelDown`, `ToggleEpg`, `Digit(u8)`) streamed from `melange-core` over WebSocket, rather than relying on mouse hover or native browser focus rings.

6. **Graceful Degradation:**
   Missing hardware (no DualShock 4 connected, no `evdev`/`cec` devices, or headless audio environments in CI) never crashes or blocks startup.

## WebSocket & REST Protocol (`core/src/server.rs`)

- **REST Endpoints:**
  - `GET /api/health`
  - `GET /api/channels`
  - `GET /api/epg`
  - `GET /api/profiles`
  - Static UI assets served from `ui/dist` at `/`
- **WebSocket (`/ws`):**
  - **Server → Client (`ServerMessage`):**
    - `{"type": "StateSnapshot", "state": MelangeState}` (sent immediately on connect)
    - `{"type": "StateUpdate", "state": MelangeState}` (broadcast on mode, overlay, profile, channel, EPG, or playback state changes, including `is_zapping` transitions)
    - `{"type": "NavEvent", "event": NavEvent}` (forwarded from keyboard/gamepad router)
  - **Client → Server (`ClientCommand`):**
    - `{"type": "SelectChannel", "channel_id": number}`
    - `{"type": "SetMode", "mode": "Home" | "LiveTv" | "Mediathek" | "Media" | "Settings"}`
    - `{"type": "SetOverlay", "overlay": "None" | "ZapBanner" | "MiniEpg" | "FullEpg" | "ProfileSwitcher"}`
    - `{"type": "SelectProfile", "profile_id": number}`
    - `{"type": "PlaySound", "sound": "focus" | "select" | "back" | "zap"}`

## Crate & Module Responsibilities

### `melange-core` (`core/`)
- **CLI & Config (`config.rs`):** Parses `--dev`, `--desktop`, `--kiosk`, `--port` and resolves database, playlist, EPG, UI dist, and sound asset paths.
- **SQLite Persistence (`db.rs`):** `rusqlite` (bundled) managing `profiles`, `channels`, `epg_cache`, and `watch_history`.
- **M3U & XMLTV Provider (`provider.rs`):** `M3uXmltvProvider` parses `#EXTM3U` playlists and XMLTV `<channel>` / `<programme>` feeds.
- **Unified Input Router (`input.rs`):** `NavEvent` enum fed by keyboard and a background `gilrs` DualShock 4 thread (180ms repeat debounce).
- **Audio Feedback (`audio.rs`):** Preloaded in-memory WAV playback via `rodio`.
- **Player Controller (`player.rs`):** Channel zapping state machine (`Idle`, `Buffering`, `Playing`, `Paused`, `is_zapping`), wrap-around `channel_up` / `channel_down`, multi-digit `zap_digit`, and `PlayerBackend` trait.
- **HTTP & WebSocket Server (`server.rs`):** `axum` server, `StateManager`, REST API, `/ws` broadcast hub, and static `ui/dist` serving.

### `melange-shell` (`shell/`)
- **GTK4 Overlay Window (`main.rs`):** `gtk4::Application` (`org.melange.tv`) layering `webkit6::WebView` (transparent RGBA) over `gtk4::GLArea` inside `gtk4::Overlay`, with capture-phase keyboard forwarding.
- **Embedded OpenGL Video (`mpv_gl.rs`):** `gtk4::GLArea` wired to `libmpv2::render::RenderContext` using `libepoxy.so.0`.

### `melange-ui` (`ui/`)
- **Bridge (`src/bridge/`):** Auto-reconnecting WebSocket store and TypeScript protocol types.
- **Spatial Nav (`src/spatial/`):** Geometry-based directional traversal with 60fps `translate3d` focus ring and `Back` history stack.
- **Glassmorphism Views (`src/components/`, `src/themes/`):** CSS custom property theme system, Home/Lockscreen with auto-fading ambient wallpaper, Zap Banner with live EPG progress and 4s auto-dismiss, Full EPG overlay, and Profile Switcher.
