set shell := ["bash", "-euo", "pipefail", "-c"]

# Generate local dev fixtures (streams, XMLTV EPG, test media, UI sounds)
seed:
    ./scripts/seed_dev.sh

# Build SolidJS glassmorphism UI into ui/dist and Companion app into companion/dist
ui-build:
    cd ui && npm install && npm run build
    cd companion && npm install && npm run build

# Run melange-shell in --dev mode (seeds dev/ and builds ui/dist + companion/dist automatically if missing)
dev:
    @if [ ! -d dev ]; then ./scripts/seed_dev.sh; fi
    @if [ ! -d ui/dist ]; then cd ui && npm install && npm run build; fi
    @if [ ! -d companion/dist ]; then cd companion && npm install && npm run build; fi
    cargo run -p melange-shell -- --dev

# Run all workspace unit and integration tests
test:
    cargo test --workspace

# Run clippy across all workspace targets
check:
    cargo clippy --workspace --all-targets -- -D warnings
