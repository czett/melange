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
https://mcdn.daserste.de/daserste/de/master.m3u8
#EXTINF:-1 tvg-id="zdf.de" tvg-name="ZDF" tvg-chno="2" group-title="Public",ZDF HD
https://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/master.m3u8
#EXTINF:-1 tvg-id="arte.de" tvg-name="ARTE" tvg-chno="3" group-title="Culture",ARTE HD
https://artesimulcast.akamaized.net/hls/live/2031003/artelive_de/index.m3u8
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
  for enc in libx264 libopenh264 mpeg4; do
    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE "^\s*V\S*\s+${enc}\b"; then
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
    echo "[seed] warning: no suitable mp4 video encoder found in ffmpeg; skipping dev/media/*.mp4" >&2
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

specs = {
    "focus.wav":  (680.0, 820.0, 0.032, 0.22),
    "select.wav": (520.0, 960.0, 0.055, 0.28),
    "back.wav":   (640.0, 380.0, 0.055, 0.25),
    "zap.wav":    (420.0, 740.0, 0.045, 0.26),
}

for name, (f0, f1, dur, amp) in specs.items():
    path = os.path.join(sounds_dir, name)
    if os.path.exists(path):
        continue
    n_samples = int(sample_rate * dur)
    frames = bytearray()
    for i in range(n_samples):
        t = i / sample_rate
        progress = i / max(1, n_samples - 1)
        freq = f0 + (f1 - f0) * progress
        env = math.sin(math.pi * progress) ** 0.7
        val = int(32767 * amp * env * math.sin(2.0 * math.pi * freq * t))
        frames.extend(struct.pack("<h", val))
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(frames))
    print(f"[seed] generated {path}")
PYEOF
}

if command -v python3 >/dev/null 2>&1; then
  generate_sounds_python
elif command -v ffmpeg >/dev/null 2>&1; then
  for pair in "focus.wav:720:0.03" "select.wav:880:0.05" "back.wav:420:0.05" "zap.wav:600:0.045"; do
    IFS=: read -r fname freq dur <<< "${pair}"
    if [ ! -f "${SOUNDS_DIR}/${fname}" ]; then
      echo "[seed] generating ${SOUNDS_DIR}/${fname} via ffmpeg"
      ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=${freq}:duration=${dur}" \
        -af "afade=t=in:ss=0:d=0.005,afade=t=out:st=0.015:d=0.015,volume=0.25" \
        "${SOUNDS_DIR}/${fname}"
    fi
  done
else
  echo "[seed] warning: neither python3 nor ffmpeg found; cannot generate assets/sounds/*.wav" >&2
fi

echo "[seed] done."
