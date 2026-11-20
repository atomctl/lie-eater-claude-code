"""Writes sounds/stamp.wav: a short, low thump (our own sound, made from a formula)."""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 44100
SECONDS = 0.25
OUT = Path(__file__).resolve().parent.parent / "sounds" / "stamp.wav"

random.seed(7)  # the same file on every run
frames = bytearray()
for i in range(int(RATE * SECONDS)):
    t = i / RATE
    body = math.sin(2 * math.pi * 90 * t) * math.exp(-t * 18)
    click = random.uniform(-1, 1) * (1 - t / 0.02) if t < 0.02 else 0.0
    sample = max(-1.0, min(1.0, 0.85 * body + 0.35 * click))
    frames += struct.pack("<h", int(sample * 32767))

OUT.parent.mkdir(exist_ok=True)
with wave.open(str(OUT), "wb") as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(RATE)
    f.writeframes(bytes(frames))

assert OUT.stat().st_size == 44 + int(RATE * SECONDS) * 2, OUT.stat().st_size
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
