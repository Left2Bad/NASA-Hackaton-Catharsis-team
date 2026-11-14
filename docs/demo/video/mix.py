"""Mix for the pitch: the voice with a pause inserted, soft clicks, a whoosh under the wipe and background music
that ducks under the voice.

Run from the Remotion project root:
    python mix.py voice_nasa/voice.wav out/nasa/mix.wav [music.mp3]

Music: "Dmitrii Spis" (nastelbom) on Pixabay, track 617068, Pixabay Content License
(https://pixabay.com/service/license-summary/). Without the third argument the mix has no music.
"""

import subprocess
import sys

import numpy as np

SR = 48000
DUR = 29.5
PAUSE_AT, PAUSE = 11.6, 0.5
CLICKS = (8.35, 16.05, 21.35)
WHOOSH = (8.45, 1.55)
MUSIC_FROM = 1.9  # s into the track: past its quiet intro, so the beat runs from frame 0
MUSIC_UNDER_VOICE_DB = -11.0  # music level against the voice while someone speaks
MUSIC_IN_GAPS_DB = -4.0  # ... in the pauses and under the end card
FADE_OUT = 1.2  # s at the very end


def read(path, channels):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ar", str(SR), "-ac", str(channels), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, channels).copy()


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-9)


def smooth(env, attack_s, release_s):
    """One-pole follower: fast to rise (attack), slow to fall (release)."""
    a, r = np.exp(-1 / (attack_s * SR)), np.exp(-1 / (release_s * SR))
    out = np.empty_like(env)
    level = 0.0
    for k, e in enumerate(env):
        coef = a if e > level else r
        level = coef * level + (1 - coef) * e
        out[k] = level
    return out


n_out = int(SR * DUR)
voice = read(sys.argv[1], 1)[:, 0]
cut = int(PAUSE_AT * SR)
voice = np.concatenate([voice[:cut], np.zeros(int(PAUSE * SR), np.float32), voice[cut:]])
voice = np.pad(voice, (0, max(0, n_out - len(voice))))[:n_out]

fx = np.zeros(n_out, np.float32)
rng = np.random.default_rng(7)
n = int(0.03 * SR)
tt = np.arange(n) / SR


def tick(freq, amp):
    return (
        (0.6 * np.sin(2 * np.pi * freq * tt) + 0.4 * rng.standard_normal(n).astype(np.float32))
        * np.exp(-tt * 350)
        * amp
    )


click = np.zeros(int(0.09 * SR), np.float32)
click[:n] += tick(2600, 0.22)
click[int(0.055 * SR) : int(0.055 * SR) + n] += tick(2100, 0.14)
for c in CLICKS:
    j = int(c * SR)
    fx[j : j + len(click)] += click[: n_out - j]
start, length = WHOOSH
w = int(length * SR)
tw = np.arange(w) / SR
noise = np.convolve(rng.standard_normal(w).astype(np.float32), np.ones(40) / 40, "same")
j = int(start * SR)
fx[j : j + w] += noise * np.sin(np.pi * tw / length) ** 2 * 0.25

mix = np.stack([voice + fx, voice + fx], axis=1)

if len(sys.argv) > 3:
    music = read(sys.argv[3], 2)[int(MUSIC_FROM * SR) :][:n_out]
    music = np.pad(music, ((0, max(0, n_out - len(music))), (0, 0)))
    speaking = voice[voice != 0]
    voice_db = rms_db(speaking[np.abs(speaking) > 0.02])
    music = music * 10 ** ((voice_db - rms_db(music)) / 20)  # music as loud as the speech, then turned down below
    # where the voice speaks: a 50 ms RMS envelope, gated, then a quick duck and a slow return
    hop = int(0.05 * SR)
    env = np.sqrt(np.convolve(voice**2, np.ones(hop) / hop, "same"))
    talking = (env > 10 ** ((voice_db - 20) / 20)).astype(np.float32)
    talk = smooth(talking[::48], 0.06, 0.3)  # computed at 1 kHz for speed
    talk = np.repeat(talk, 48)[:n_out]
    talk = np.pad(talk, (0, n_out - len(talk)), constant_values=talk[-1])
    gain_db = MUSIC_IN_GAPS_DB + (MUSIC_UNDER_VOICE_DB - MUSIC_IN_GAPS_DB) * talk
    gain = 10 ** (gain_db / 20)
    t = np.arange(n_out) / SR
    gain *= np.clip((DUR - t) / FADE_OUT, 0, 1)  # fade out at the end
    gain *= np.clip(t / 0.05, 0, 1)  # a 50 ms ramp at frame 0 against a click
    mix += music * gain[:, None]

peak = float(np.abs(mix).max())
if peak > 0.98:
    mix *= 0.98 / peak
subprocess.run(
    [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-f",
        "f32le",
        "-ar",
        str(SR),
        "-ac",
        "2",
        "-i",
        "-",
        "-c:a",
        "pcm_s16le",
        sys.argv[2],
    ],
    input=mix.astype(np.float32).tobytes(),
    check=True,
)
print("mix", sys.argv[2], "peak", round(peak, 3), "music" if len(sys.argv) > 3 else "no music")
