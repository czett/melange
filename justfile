set shell := ["bash", "-euo", "pipefail", "-c"]

# Generate local dev fixtures (streams, XMLTV EPG, test media, UI sounds)
seed:
    ./scripts/seed_dev.sh

# Build SolidJS glassmorphism UI into ui/dist and Companion app into companion/dist
ui-build:
    cd ui && npm install && npm run build
    cd companion && npm install && npm run build

# Run melange-shell in --dev mode (refreshes dev/ seed fixtures and builds ui/dist + companion/dist if missing)
dev:
    ./scripts/seed_dev.sh
    @if [ ! -d ui/dist ]; then cd ui && npm install && npm run build; fi
    @if [ ! -d companion/dist ]; then cd companion && npm install && npm run build; fi
    MELANGE_BIND_ADDR=0.0.0.0:9000 cargo run -p melange-shell -- --dev

# Run all workspace unit and integration tests
test:
    cargo test --workspace

# Run clippy across all workspace targets
check:
    cargo clippy --workspace --all-targets -- -D warnings

# Build frontends, compile release binary with embedded assets, and package kiosk tarball
package-release:
    cd ui && npm ci && npm run build
    cd companion && npm ci && npm run build
    cargo build --release --bin melange-shell
    rm -rf dist/melange-kiosk-linux-x86_64
    mkdir -p dist/melange-kiosk-linux-x86_64/deploy
    cp target/release/melange-shell dist/melange-kiosk-linux-x86_64/deploy/
    cp deploy/* dist/melange-kiosk-linux-x86_64/deploy/
    cp README.md ARCHITECTURE.md dist/melange-kiosk-linux-x86_64/
    tar -C dist -czf dist/melange-kiosk-linux-x86_64.tar.gz melange-kiosk-linux-x86_64
    rm -rf dist/melange-kiosk-linux-x86_64
