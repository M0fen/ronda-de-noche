# Run: python3 tools/compose_theme.py && ffmpeg -i tools/theme.wav -b:a 96k src/sfx/theme.mp3  (needs numpy, scipy, ffmpeg)
# "Ronda de noche" title theme: her lullaby on a worn music box, then her own humming joins it,
# strings and a low drone underneath; the box winds down at the end and the loop comes back round.
import numpy as np, subprocess, os
from scipy.signal import fftconvolve, butter, sosfilt

SR = 44100
D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(D)
rng = np.random.default_rng(1992)
mtof = lambda m: 440.0 * 2 ** ((m - 69) / 12)
BEAT = 60 / 76

def env_exp(n, a, d):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / d)
    return e

def mbox_note(m, dur=3.2, vel=1.0, detune=0.0):
    n = int(dur * SR); t = np.arange(n) / SR
    f = mtof(m) * 2 ** (detune / 1200)
    x = np.sin(2 * np.pi * f * t) * env_exp(n, 0.002, 0.9 + 600 / f) * 0.55
    x += np.sin(2 * np.pi * f * 2.0 * t) * env_exp(n, 0.002, 0.35) * 0.06
    x += np.sin(2 * np.pi * f * 5.93 * t + 0.3) * env_exp(n, 0.001, 0.07) * 0.3
    x += np.sin(2 * np.pi * f * 3.01 * t) * env_exp(n, 0.001, 0.18) * 0.05
    x += np.sin(2 * np.pi * f * 14.1 * t) * env_exp(n, 0.0005, 0.012) * 0.08
    click = rng.standard_normal(n) * env_exp(n, 0.0002, 0.003) * 0.06
    return (x + click) * vel

def saw_voice(f, n, bright=3500):
    t = np.arange(n) / SR
    x = np.zeros(n)
    k = 1
    while k * f < bright:
        x += np.sin(2 * np.pi * k * f * t + rng.uniform(0, 6.28)) / k
        k += 1
    return x

def pad_chord(midis, dur, a=1.6, r=2.4, gain=0.08):
    n = int((dur + r) * SR); t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for m in midis:
        for det, pan in ((-7, 0.3), (6, 0.7)):
            f = mtof(m) * 2 ** (det / 1200)
            v = saw_voice(f, n, 2600) * (1 + 0.06 * np.sin(2 * np.pi * (4.6 + rng.uniform(-0.4, 0.4)) * t))
            out[:, 0] += v * (1 - pan); out[:, 1] += v * pan
    e = np.minimum(1, t / a) * np.clip((dur + r - t) / r, 0, 1) ** 1.5
    sos = butter(2, 1500, 'low', fs=SR, output='sos')
    out = sosfilt(sos, out, axis=0) * e[:, None] * gain / len(midis)
    return out

def piano(m, dur=5.0, vel=0.5):
    n = int(dur * SR); t = np.arange(n) / SR; f0 = mtof(m)
    x = np.zeros(n)
    for k in range(1, 9):
        fk = f0 * k * np.sqrt(1 + 0.0004 * k * k)
        x += np.sin(2 * np.pi * fk * t) * np.exp(-t * (0.6 + 0.5 * k)) / k ** 1.1
    x += rng.standard_normal(n) * env_exp(n, 0.001, 0.02) * 0.05
    return x * env_exp(n, 0.004, 2.8) * vel

def place(buf, x, at, gain=1.0, pan=0.5):
    i = int(at * SR)
    if i >= len(buf): return
    if x.ndim == 1: x = np.stack([x * np.sqrt(1 - pan), x * np.sqrt(pan)], 1)
    j = min(len(buf), i + len(x))
    buf[i:j] += x[: j - i] * gain

# ---- the score --------------------------------------------------------------------------
GRID = [  # her tune on the beat grid: (midi in the box's octave, beats); 0 = rest
    (79, 0.5), (81, 0.5), (79, 2), (0, 0.5),
    (79, 1), (81, 0.5), (74, 0.25), (74, 0.5), (72, 2.5), (0, 0.5),
    (76, 0.5), (76, 0.75), (76, 0.75), (0, 1), (74, 1.5), (0, 1),
    (79, 0.5), (81, 0.5), (79, 3), (0, 0.5),
    (72, 0.5), (74, 0.5), (76, 1.25), (76, 0.5), (76, 0.5), (72, 2.5),
]
# the same tune as she actually hums it (onsets in seconds from the recording)
HUMMED = [(0.00, 79), (0.45, 81), (0.81, 79), (2.38, 79), (3.09, 81), (3.55, 74), (3.76, 74), (4.12, 72),
          (6.03, 76), (6.35, 76), (7.02, 76), (8.92, 74), (10.73, 79), (11.12, 81), (11.46, 79),
          (13.76, 72), (14.18, 74), (14.48, 76), (15.43, 76), (15.91, 76), (16.28, 76), (16.70, 72)]
grid_len = sum(b for _, b in GRID) * BEAT

INTRO = 7.0
V1 = INTRO
V2 = V1 + grid_len + 1.2
HUM_LEN = 18.1
OUT = V2 + HUM_LEN + 0.8
END = OUT + 9.5
TAIL = 4.0
N = int((END + TAIL) * SR)
mix = np.zeros((N, 2)); box = np.zeros((N, 2)); hum = np.zeros((N, 2))

# drone: A1 with its fifth, swelling slowly; in the outro it slides to B-flat and back
t = np.arange(N) / SR
drone_f = np.full(N, mtof(33))
i0, i1 = int((OUT + 2) * SR), int((OUT + 6.5) * SR)
drone_f[i0:i1] = mtof(33) * 2 ** (np.clip((np.arange(i1 - i0) / SR) / 2.0, 0, 1) / 12)
phase = np.cumsum(2 * np.pi * drone_f / SR)
dr = (np.sin(phase) * 0.5 + np.sin(phase * 1.5) * 0.18 + np.sin(phase * 2) * 0.1) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.07 * t))
dr *= np.clip(t / 4, 0, 1) * np.clip((END + TAIL - t) / TAIL, 0, 1)
mix += np.stack([dr, dr], 1) * 0.07
# a breath of filtered noise like wind in a stairwell
wind = sosfilt(butter(2, [180, 900], 'band', fs=SR, output='sos'), rng.standard_normal(N))
wind *= (0.5 + 0.5 * np.sin(2 * np.pi * 0.05 * t + 1)) * 0.035 * np.clip(t / 4, 0, 1) * np.clip((END + TAIL - t) / TAIL, 0, 1)
mix += np.stack([wind, np.roll(wind, 1200)], 1)

# intro: two low piano notes, a single box note far off
place(mix, piano(45, 6, 0.32), 0.6, pan=0.4); place(mix, piano(40, 6, 0.26), 3.4, pan=0.6)
place(box, mbox_note(79, 3, 0.5), 5.2, pan=0.55)

# verse 1: the box alone over the strings
chords1 = [([57, 60, 64, 67], 3.5), ([50, 53, 57, 60], 5.25), ([57, 60, 64], 2.75), ([52, 56, 59, 62], 2.75), ([53, 57, 60, 64], 4.5), ([57, 60, 64], 2.75), ([52, 56, 59, 60], 3.0)]
tt = V1
for ch, beats in chords1:
    place(mix, pad_chord(ch, beats * BEAT, gain=0.07), tt); tt += beats * BEAT
tt = V1
for i, (m, b) in enumerate(GRID):
    if m: place(box, mbox_note(m, 3.2, 0.9 + rng.uniform(-0.1, 0.1), rng.uniform(-9, 9)), tt + rng.uniform(-0.012, 0.012), pan=0.48 + rng.uniform(-0.05, 0.05))
    tt += b * BEAT
place(mix, piano(45, 6, 0.3), V1, pan=0.45)

# verse 2: her humming, the box following her timing, a lower piano doubling
humwav = os.path.join(D, 'hum44.wav')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', os.path.join(ROOT, 'src', 'sfx', 'hum.mp3'), '-ac', '1', '-ar', str(SR), humwav], check=True)
import wave
with wave.open(humwav) as w: h = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
h = h / (np.abs(h).max() + 1e-9)
place(hum, h * 0.62, V2, pan=0.5)
for on, m in HUMMED:
    place(box, mbox_note(m, 3.2, 0.62, rng.uniform(-8, 8)), V2 + on + 0.02, pan=0.62)
    if on in (0.00, 4.12, 10.73, 13.76): place(mix, piano(m - 36, 5, 0.22), V2 + on, pan=0.4)
chords2 = [(0.0, [57, 60, 64, 67]), (3.55, [50, 53, 57, 60]), (6.03, [57, 60, 64]), (8.92, [52, 56, 59, 62]), (10.73, [53, 57, 60, 64]), (13.76, [57, 60, 64]), (15.43, [52, 56, 59, 60])]
for k, (on, ch) in enumerate(chords2):
    end = chords2[k + 1][0] if k + 1 < len(chords2) else HUM_LEN + 0.5
    place(mix, pad_chord(ch, end - on, gain=0.085), V2 + on)

# outro: the spring runs down: the opening phrase again, slower and slower, sagging in pitch
tt = OUT + 0.6
for i, (m, b) in enumerate(GRID[:9]):
    slow = 1 + i * 0.22
    if m: place(box, mbox_note(m - i * 0.12, 3.5, 0.8 - i * 0.05, rng.uniform(-14, 14) - i * 9), tt, pan=0.5)
    tt += b * BEAT * slow
place(mix, pad_chord([46, 53, 58, 61], 6.5, a=3.0, r=3.5, gain=0.07), OUT + 1.5)   # B-flat minor shadow
place(mix, pad_chord([45, 52, 57, 60], 4.0, a=2.5, r=3.0, gain=0.05), OUT + 6.0)   # home, barely
place(mix, piano(33, 7, 0.35), OUT + 6.4, pan=0.5)

# warp the box a little, like an old mechanism
lfo = 0.0009 * np.sin(2 * np.pi * 0.31 * t) + 0.0005 * np.sin(2 * np.pi * 0.83 * t)
idx = np.clip(np.arange(N) * (1 + 0) + lfo * SR * 2.0, 0, N - 1)
box = np.stack([np.interp(idx, np.arange(N), box[:, c]) for c in (0, 1)], 1)
# the box sits in a small wooden case: a body resonance, and it rolls off the very top
box = sosfilt(butter(2, 9000, 'low', fs=SR, output='sos'), box, axis=0)
box = box + sosfilt(butter(2, [700, 1400], 'band', fs=SR, output='sos'), box, axis=0) * 0.35
hum = sosfilt(butter(2, [140, 5000], 'band', fs=SR, output='sos'), hum, axis=0)

# ---- room: a long dark hall ------------------------------------------------------------------
L = int(3.2 * SR); ti = np.arange(L) / SR
ir = np.zeros((L, 2))
for c in (0, 1):
    nz = rng.standard_normal(L) * np.exp(-ti / 0.62) * np.clip(ti / 0.012, 0, 1)
    ir[:, c] = sosfilt(butter(1, 4200, 'low', fs=SR, output='sos'), nz)
for d, g in ((0.017, 0.5), (0.029, 0.35), (0.041, 0.28)): ir[int(d * SR), :] += g
ir /= np.sqrt((ir ** 2).sum(0))[None, :]
def verb(x, wet):
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in (0, 1)], 1)
    return x * (1 - wet) + y * wet * 1.3
mix = verb(mix, 0.35) + verb(box * 0.3, 0.5) + verb(hum, 0.42) * 0.9

# the loop restarts at END while this copy's tail rings out (the game overlaps them)
fade = np.clip((END + TAIL - np.arange(len(mix)) / SR) / TAIL, 0, 1) ** 0.5
mix[int(END * SR):] *= fade[int(END * SR):, None]
# master
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix /= np.abs(mix).max() / 0.89
out = os.path.join(D, 'theme.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
print('theme', round(END, 2), 's', out)
