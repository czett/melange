#!/usr/bin/env bash
# Idempotent provisioning script for the Melange Kiosk Appliance.
# Supports minimal Debian, Ubuntu, and Arch Linux systems running Wayland `cage`.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    echo "Error: setup-appliance.sh must be run as root (use sudo)." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MELANGE_USER="melange"

echo "==> 1. Creating '${MELANGE_USER}' system user and configuring groups..."
if ! id -u "${MELANGE_USER}" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/var/lib/${MELANGE_USER}" --shell /usr/sbin/nologin "${MELANGE_USER}"
fi

for grp in video render input audio; do
    if getent group "${grp}" >/dev/null 2>&1; then
        usermod -aG "${grp}" "${MELANGE_USER}"
    fi
done

echo "==> 2. Installing udev rules for DualShock 4, 2.4GHz remotes, and HDMI-CEC..."
install -D -m 0644 "${SCRIPT_DIR}/99-melange-input.rules" /etc/udev/rules.d/99-melange-input.rules
udevadm control --reload-rules
udevadm trigger

echo "==> 3. Enabling systemd-logind lingering for PipeWire user session..."
loginctl enable-linger "${MELANGE_USER}"

echo "==> 4. Installing melange-shell binary and /etc/melange/melange.toml..."
if [[ -f "${SCRIPT_DIR}/melange-shell" ]]; then
    install -D -m 0755 "${SCRIPT_DIR}/melange-shell" /usr/local/bin/melange-shell
elif [[ -f "${SCRIPT_DIR}/../target/release/melange-shell" ]]; then
    install -D -m 0755 "${SCRIPT_DIR}/../target/release/melange-shell" /usr/local/bin/melange-shell
else
    echo "Warning: melange-shell binary not found in ${SCRIPT_DIR} or ../target/release/." >&2
fi

mkdir -p /etc/melange "/var/lib/${MELANGE_USER}/media" "/var/lib/${MELANGE_USER}/wallpapers"
chown -R "${MELANGE_USER}:${MELANGE_USER}" "/var/lib/${MELANGE_USER}"

if [[ ! -f /etc/melange/melange.toml ]]; then
    install -m 0644 "${SCRIPT_DIR}/melange.toml.example" /etc/melange/melange.toml
fi

echo "==> 5. Installing and enabling melange-kiosk.service..."
install -D -m 0644 "${SCRIPT_DIR}/melange-kiosk.service" /etc/systemd/system/melange-kiosk.service
systemctl daemon-reload
systemctl enable melange-kiosk.service

echo "==> Melange kiosk appliance provisioning complete."
echo "    Start now with: systemctl start melange-kiosk.service"
