#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="${ROOT_DIR}/dev"
MEDIA_DIR="${DEV_DIR}/media"
SOUNDS_DIR="${ROOT_DIR}/assets/sounds"

mkdir -p "${DEV_DIR}" "${MEDIA_DIR}" "${SOUNDS_DIR}"

echo "[seed] writing ${DEV_DIR}/channels.m3u"
cat > "${DEV_DIR}/channels.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1 tvg-id="daserste.de" tvg-name="Das Erste" tvg-chno="1" group-title="Public",Das Erste HD
https://daserste-live.ard-mcdn.de/daserste/live/hls/de/master.m3u8
#EXTINF:-1 tvg-id="zdf.de" tvg-name="ZDF" tvg-chno="2" group-title="Public",ZDF HD
https://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/master.m3u8
#EXTINF:-1 tvg-id="arte.de" tvg-name="ARTE" tvg-chno="3" group-title="Culture",ARTE HD
https://artesimulcast.akamaized.net/hls/live/2030993/artelive_de/master.m3u8
#EXTINF:-1 tvg-id="3sat.de" tvg-name="3sat" tvg-chno="4" group-title="Culture",3sat HD
https://zdf-hls-18.akamaized.net/hls/live/2016501/dach/high/master.m3u8
EOF

echo "[seed] writing ${DEV_DIR}/epg.xml"
if command -v python3 >/dev/null 2>&1; then
  python3 - "${DEV_DIR}/epg.xml" <<'PYEOF'
import sys
from datetime import datetime, timedelta, timezone

out_path = sys.argv[1]
now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

def fmt(dt):
    return dt.strftime("%Y%m%d%H%M%S +0000")

channels = [
    ("daserste.de", "Das Erste HD", [
        ("Tagesschau", "Aktuelle Nachrichten aus Deutschland und der Welt.", 0, 1),
        ("Weltspiegel", "Auslandskorrespondenten berichten.", 1, 2),
        ("Tatort", "Kriminalfilm am Abend.", 2, 4),
    ]),
    ("zdf.de", "ZDF HD", [
        ("heute", "Nachrichten und Wetter.", 0, 1),
        ("Terra X", "Dokumentation ueber Natur und Geschichte.", 1, 2),
        ("aktuelles sportstudio", "Berichte und Analysen vom Sport.", 2, 4),
    ]),
    ("arte.de", "ARTE HD", [
        ("ARTE Journal", "Europaeische Nachrichten.", 0, 1),
        ("Karambolage", "Kleine Eigenheiten der franzoesischen und deutschen Kultur.", 1, 2),
        ("Tracks", "Magazin fuer Popkultur und Musik.", 2, 3),
    ]),
    ("3sat.de", "3sat HD", [
        ("Kulturzeit", "Das taegliche Kulturmagazin.", 0, 1),
        ("nano", "Das Wissenschaftsmagazin.", 1, 2),
        ("scobel", "Gespraeche ueber Wissenschaft und Philosophie.", 2, 3),
    ]),
]

lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="melange-seed">']
for cid, cname, _ in channels:
    lines.append(f'  <channel id="{cid}">')
    lines.append(f'    <display-name lang="de">{cname}</display-name>')
    lines.append('  </channel>')

for cid, _, progs in channels:
    for title, desc, h0, h1 in progs:
        start = fmt(now + timedelta(hours=h0))
        stop = fmt(now + timedelta(hours=h1))
        lines.append(f'  <programme start="{start}" stop="{stop}" channel="{cid}">')
        lines.append(f'    <title lang="de">{title}</title>')
        lines.append(f'    <desc lang="de">{desc}</desc>')
        lines.append('  </programme>')

lines.append('</tv>')
with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
PYEOF
else
  cat > "${DEV_DIR}/epg.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="melange-seed">
  <channel id="daserste.de">
    <display-name lang="de">Das Erste HD</display-name>
  </channel>
  <channel id="zdf.de">
    <display-name lang="de">ZDF HD</display-name>
  </channel>
  <channel id="arte.de">
    <display-name lang="de">ARTE HD</display-name>
  </channel>
  <channel id="3sat.de">
    <display-name lang="de">3sat HD</display-name>
  </channel>
  <programme start="20261114120000 +0000" stop="20261114130000 +0000" channel="daserste.de">
    <title lang="de">Tagesschau</title>
    <desc lang="de">Aktuelle Nachrichten.</desc>
  </programme>
  <programme start="20261114120000 +0000" stop="20261114130000 +0000" channel="zdf.de">
    <title lang="de">heute</title>
    <desc lang="de">Nachrichten und Wetter.</desc>
  </programme>
  <programme start="20261114120000 +0000" stop="20261114130000 +0000" channel="arte.de">
    <title lang="de">ARTE Journal</title>
    <desc lang="de">Europaeische Nachrichten.</desc>
  </programme>
  <programme start="20261114120000 +0000" stop="20261114130000 +0000" channel="3sat.de">
    <title lang="de">Kulturzeit</title>
    <desc lang="de">Das Kulturmagazin.</desc>
  </programme>
</tv>
EOF
fi

pick_video_encoder() {
  local encoders
  encoders="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
  for enc in libx264 libopenh264 mpeg4 libsvtav1; do
    if printf '%s\n' "${encoders}" | grep -qE "^[[:space:]]*V[^[:space:]]*[[:space:]]+${enc}([[:space:]]|$)"; then
      echo "${enc}"
      return 0
    fi
  done
  return 1
}

if command -v ffmpeg >/dev/null 2>&1; then
  if VENC="$(pick_video_encoder)"; then
    if [ ! -f "${MEDIA_DIR}/test_bars.mp4" ]; then
      echo "[seed] generating ${MEDIA_DIR}/test_bars.mp4 (${VENC})"
      ffmpeg -y -loglevel error \
        -f lavfi -i "smptebars=size=1280x720:rate=30:duration=5" \
        -f lavfi -i "sine=frequency=440:duration=5" \
        -c:v "${VENC}" -pix_fmt yuv420p -c:a aac -shortest \
        "${MEDIA_DIR}/test_bars.mp4" || echo "[seed] warning: failed to generate test_bars.mp4" >&2
    fi
    if [ ! -f "${MEDIA_DIR}/test_tone.mp4" ]; then
      echo "[seed] generating ${MEDIA_DIR}/test_tone.mp4 (${VENC})"
      ffmpeg -y -loglevel error \
        -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=5" \
        -f lavfi -i "sine=frequency=660:duration=5" \
        -c:v "${VENC}" -pix_fmt yuv420p -c:a aac -shortest \
        "${MEDIA_DIR}/test_tone.mp4" || echo "[seed] warning: failed to generate test_tone.mp4" >&2
    fi
  else
    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE "^\s*V\S*\s+libvpx-vp9\b"; then
      if [ ! -f "${MEDIA_DIR}/test_bars.webm" ]; then
        echo "[seed] generating ${MEDIA_DIR}/test_bars.webm (libvpx-vp9)"
        ffmpeg -y -loglevel error \
          -f lavfi -i "smptebars=size=1280x720:rate=30:duration=5" \
          -f lavfi -i "sine=frequency=440:duration=5" \
          -c:v libvpx-vp9 -c:a libopus -shortest \
          "${MEDIA_DIR}/test_bars.webm" || echo "[seed] warning: failed to generate test_bars.webm" >&2
      fi
    elif ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE "^\s*V\S*\s+mpeg2video\b"; then
      if [ ! -f "${MEDIA_DIR}/test_bars.ts" ]; then
        echo "[seed] generating ${MEDIA_DIR}/test_bars.ts (mpeg2video)"
        ffmpeg -y -loglevel error \
          -f lavfi -i "smptebars=size=1280x720:rate=30:duration=5" \
          -f lavfi -i "sine=frequency=440:duration=5" \
          -c:v mpeg2video -c:a mp2 -shortest \
          "${MEDIA_DIR}/test_bars.ts" || echo "[seed] warning: failed to generate test_bars.ts" >&2
      fi
    elif ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE "^\s*V\S*\s+mjpeg\b"; then
      if [ ! -f "${MEDIA_DIR}/test_bars.avi" ]; then
        echo "[seed] generating ${MEDIA_DIR}/test_bars.avi (mjpeg)"
        ffmpeg -y -loglevel error \
          -f lavfi -i "smptebars=size=1280x720:rate=30:duration=5" \
          -f lavfi -i "sine=frequency=440:duration=5" \
          -c:v mjpeg -c:a pcm_s16le -shortest \
          "${MEDIA_DIR}/test_bars.avi" || echo "[seed] warning: failed to generate test_bars.avi" >&2
      fi
    else
      echo "[seed] warning: no suitable video encoder found in ffmpeg; skipping dev/media/* generation" >&2
    fi
  fi
else
  echo "[seed] warning: ffmpeg not found; skipping dev/media/*.mp4 generation" >&2
fi

generate_sounds_python() {
  python3 - "${SOUNDS_DIR}" <<'PYEOF'
import math
import os
import struct
import sys
import wave

sounds_dir = sys.argv[1]
sample_rate = 44100
# Normalize all micro-clicks to -16 dBFS (~0.1585 full scale)
target_peak = 10.0 ** (-16.0 / 20.0)


def lowpass(samples, cutoff_hz):
    rc = 1.0 / (2.0 * math.pi * cutoff_hz)
    dt = 1.0 / sample_rate
    alpha = dt / (rc + dt)
    out = []
    y = 0.0
    for x in samples:
        y = y + alpha * (x - y)
        out.append(y)
    return out


def damped_pop(dur_s, f0, f1, tau_s, cutoff_hz, harmonic_mix=0.22):
    n_samples = int(sample_rate * dur_s)
    attack_n = max(1, int(sample_rate * 0.0003))
    release_n = max(1, int(sample_rate * 0.0012))
    phase = 0.0
    raw = []
    for i in range(n_samples):
        t = i / sample_rate
        progress = i / max(1, n_samples - 1)
        freq = f0 + (f1 - f0) * progress
        phase += 2.0 * math.pi * freq / sample_rate
        env = math.exp(-t / tau_s)
        if i < attack_n:
            env *= 0.5 * (1.0 - math.cos(math.pi * i / attack_n))
        if i >= n_samples - release_n:
            rem = (n_samples - 1 - i) / max(1, release_n)
            env *= 0.5 * (1.0 - math.cos(math.pi * rem))
        sig = math.sin(phase) + harmonic_mix * math.sin(2.0 * phase)
        raw.append(env * sig)
    return lowpass(raw, cutoff_hz)


def double_tap(dur_s, f_first, f_second, tap2_delay_s, cutoff_hz):
    n_samples = int(sample_rate * dur_s)
    tap1 = damped_pop(dur_s, f_first, f_first * 1.08, 0.0015, cutoff_hz, 0.20)
    tap2_offset = int(sample_rate * tap2_delay_s)
    tap2_dur = max(0.004, dur_s - tap2_delay_s)
    tap2 = damped_pop(tap2_dur, f_second, f_second * 1.04, 0.0018, cutoff_hz, 0.18)
    out = list(tap1)
    for idx, val in enumerate(tap2):
        pos = tap2_offset + idx
        if pos < n_samples:
            out[pos] += 0.88 * val
    return out


def write_wav(name, samples):
    peak = max((abs(s) for s in samples), default=0.0)
    scale = (32767.0 * target_peak / peak) if peak > 1e-9 else 0.0
    frames = bytearray()
    for s in samples:
        val = max(-32768, min(32767, int(round(s * scale))))
        frames.extend(struct.pack("<h", val))
    path = os.path.join(sounds_dir, name)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(frames))
    print(f"[seed] generated {path} ({len(samples) / sample_rate * 1000:.1f} ms, -16 dBFS)")


# Crisp, dry Apple-style tactile micro-clicks
nav_click = damped_pop(0.009, 1100.0, 960.0, 0.0018, 2400.0, 0.22)
select_click = double_tap(0.014, 820.0, 1250.0, 0.0055, 2600.0)
back_click = damped_pop(0.012, 640.0, 420.0, 0.0028, 1700.0, 0.16)
zap_click = damped_pop(0.014, 740.0, 1120.0, 0.0024, 2400.0, 0.20)
error_click = damped_pop(0.024, 260.0, 235.0, 0.0055, 1050.0, 0.18)

write_wav("nav.wav", nav_click)
write_wav("focus.wav", nav_click)
write_wav("select.wav", select_click)
write_wav("back.wav", back_click)
write_wav("zap.wav", zap_click)
write_wav("error.wav", error_click)
PYEOF
}

if command -v python3 >/dev/null 2>&1; then
  generate_sounds_python
elif command -v ffmpeg >/dev/null 2>&1; then
  for pair in "nav.wav:1100:0.009" "focus.wav:1100:0.009" "select.wav:1040:0.014" "back.wav:520:0.012" "zap.wav:880:0.014" "error.wav:260:0.024"; do
    IFS=: read -r fname freq dur <<< "${pair}"
    echo "[seed] generating ${SOUNDS_DIR}/${fname} via ffmpeg"
    ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=${freq}:duration=${dur}" \
      -af "lowpass=f=2200,afade=t=in:ss=0:d=0.001,afade=t=out:st=0.002:d=${dur},volume=0.16" \
      "${SOUNDS_DIR}/${fname}"
  done
else
  echo "[seed] warning: neither python3 nor ffmpeg found; cannot generate assets/sounds/*.wav" >&2
fi

echo "[seed] done."
