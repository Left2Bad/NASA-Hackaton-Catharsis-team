"""Mix for the pitch: the voice with a pause inserted, soft clicks and a whoosh under the wipe.
Run from the Remotion project root: python mix.py voice_nasa/voice.wav out/nasa/mix.wav"""
import subprocess
import sys

import numpy as np

SR = 48000
DUR = 29.5
PAUSE_AT, PAUSE = 11.6, 0.5
CLICKS = (8.35, 16.05, 21.35)
WHOOSH = (8.45, 1.55)

v = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-ar", str(SR), "-ac", "1", "-f", "f32le", "-"],
                                 capture_output=True, check=True).stdout, np.float32).copy()
i = int(PAUSE_AT * SR)
v = np.concatenate([v[:i], np.zeros(int(PAUSE * SR), np.float32), v[i:]])
out = np.zeros(int(SR * DUR), np.float32)
out[: min(len(v), len(out))] += v[: len(out)]

rng = np.random.default_rng(7)
n = int(0.03 * SR)
tt = np.arange(n) / SR


def tick(freq, amp):
    return (0.6 * np.sin(2 * np.pi * freq * tt) + 0.4 * rng.standard_normal(n).astype(np.float32)) * np.exp(-tt * 350) * amp


click = np.zeros(int(0.09 * SR), np.float32)
click[:n] += tick(2600, 0.22)
click[int(0.055 * SR): int(0.055 * SR) + n] += tick(2100, 0.14)
for c in CLICKS:
    j = int(c * SR)
    out[j: j + len(click)] += click[: len(out) - j]

start, length = WHOOSH
w = int(length * SR)
tw = np.arange(w) / SR
noise = np.convolve(rng.standard_normal(w).astype(np.float32), np.ones(40) / 40, "same")
j = int(start * SR)
out[j: j + w] += noise * np.sin(np.pi * tw / length) ** 2 * 0.25

peak = float(np.abs(out).max())
if peak > 0.98:
    out *= 0.98 / peak
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "pcm_s16le", sys.argv[2]],
               input=out.tobytes(), check=True)
print("mix", sys.argv[2], "peak", round(peak, 3))
