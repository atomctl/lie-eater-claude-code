#!/usr/bin/env python3
"""An eye in ASCII, made by a formula: a brightness field of an eye, mapped to characters.

usage: eye.py <width> <height> [--png out.png]
No picture is traced: the shape is two lid curves, an iris, a pupil, a glint and a fading glow.
"""
import math, sys

RAMP = " .':;clodxkO0KXNWM"   # dark to bright, for a dark terminal


def noise(x, y):
    """A fixed speckle, the same at every run."""
    n = math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return n - math.floor(n)


def lids(ax):
    """The two lid curves at a distance ax from the middle: pointed corners, the upper lid arched more."""
    span = max(0.0, 1 - ax ** 1.9)
    return -0.44 * span ** 0.72, 0.31 * span ** 0.86


def bright(x, y):
    """x in -1..1 across the eye; returns 0..1."""
    ax = abs(x)
    top, bottom = lids(min(ax, 1.0))
    inside = ax < 1 and top < y < bottom
    if inside:
        d = math.hypot(x, (y + 0.03) * 1.04)                # from the middle of the iris
        if d < 0.10:                                        # the pupil
            b = 0.02
        elif d < 0.345:                                     # the iris: bright, with rays and a soft inner ring
            ray = 0.5 + 0.5 * math.sin(math.atan2(y + 0.03, x) * 22 + d * 9)
            b = 0.80 + 0.20 * ray - (0.22 if d < 0.15 else 0.0)
        elif d < 0.415:                                     # the dark rim around the iris
            b = 0.06
        else:                                               # the white: mid grey, darker toward the corners
            b = 0.44 - 0.20 * ax ** 1.4
        if math.hypot(x + 0.13, y + 0.17) < 0.050:          # the glint
            b = 1.0
        shade = (y - top) / 0.10                            # the shadow under the upper lid
        if shade < 1:
            b *= 0.35 + 0.65 * max(0.0, shade)
        return max(0.0, min(1.0, b + (noise(x * 40, y * 40) - 0.5) * 0.05))
    # the lids as a firm line; the upper one heavier
    if ax < 1.04:
        t, bt = lids(min(ax, 0.999))
        if abs(y - t) < 0.040:
            return 0.60
        if abs(y - bt) < 0.028:
            return 0.46
    # a crease above, and a glow of dots that thins out
    edge = min(abs(y - top), abs(y - bottom)) if ax < 1 else math.hypot(ax - 1, y)
    b = 0.0
    crease = abs(y - (-0.56 * max(0.0, 1 - (ax / 0.92) ** 2.0) ** 0.75))
    if ax < 0.9 and crease < 0.016:
        b = 0.20
    glow = max(0.0, 0.20 - edge)
    if noise(x * 31, y * 57) < glow * 1.9:
        b = max(b, 0.08 + glow * 0.30)
    return b


def eye(width, height):
    rows = []
    for j in range(height):
        y = (j + 0.5) / height * 1.50 - 0.80
        row = ""
        for i in range(width):
            x = (i + 0.5) / width * 2.5 - 1.25
            # four samples in the cell, so that edges are smooth
            b = sum(bright(x + dx * 1.25 / width, y + dy * 0.78 / height) for dx in (-0.5, 0.5) for dy in (-0.5, 0.5)) / 4
            row += RAMP[min(len(RAMP) - 1, int(b * (len(RAMP) - 0.01)))]
        rows.append(row.rstrip())
    while rows and rows[0] == "":
        rows.pop(0)
    while rows and rows[-1] == "":
        rows.pop()
    return rows


if __name__ == "__main__":
    w, h = int(sys.argv[1]), int(sys.argv[2])
    art = eye(w, h)
    print("\n".join(art))
    if "--png" in sys.argv:
        from PIL import Image, ImageDraw, ImageFont
        font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 16)
        im = Image.new("RGB", (int(w * 9.7) + 40, len(art) * 19 + 40), "#0d1117")
        d = ImageDraw.Draw(im)
        for k, row in enumerate(art):
            d.text((20, 20 + k * 19), row, font=font, fill="#d6dbe0")
        im.save(sys.argv[sys.argv.index("--png") + 1])
