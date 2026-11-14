set shell := ["bash", "-euo", "pipefail", "-c"]

# Generate local dev fixtures (streams, XMLTV EPG, test media, UI sounds)
seed:
    ./scripts/seed_dev.sh

# Run melange-shell in --dev mode (seeds dev/ automatically if missing)
dev:
    @if [ ! -d dev ]; then ./scripts/seed_dev.sh; fi
    cargo run -p melange-shell -- --dev

# Run all workspace unit and integration tests
test:
    cargo test --workspace

# Run clippy across all workspace targets
check:
    cargo clippy --workspace --all-targets
