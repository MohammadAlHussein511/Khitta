#!/usr/bin/env python3
"""Generates the legacy (pre-API-26) launcher PNGs to match res/drawable/ic_launcher_foreground.xml.

Adaptive icons are vector-based; these PNGs are only the fallback for Android 8 launcher pins
and for tooling that reads mipmap density buckets.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "res")

BG = (79, 70, 229, 255)          # #4F46E5
WHITE = (255, 255, 255, 255)
CHECK = (79, 70, 229, 255)

DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def render(size: int) -> Image.Image:
    s = size * 4  # supersample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = s / 108.0  # work in the 108dp adaptive-icon coordinate space

    # full-bleed rounded background (legacy icons are squircle-ish)
    r = 22 * u
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=BG)

    def cell(x, y, alpha):
        col = (255, 255, 255, int(255 * alpha))
        d.rounded_rectangle([x * u, y * u, (x + 26) * u, (y + 26) * u], radius=7 * u, fill=col)

    cell(26, 26, 1.00)
    cell(56, 26, 0.78)
    cell(26, 56, 0.50)
    cell(56, 56, 0.32)

    # check mark inside the top-left cell
    d.line([(32.6 * u, 39.2 * u), (37.2 * u, 43.8 * u), (46.2 * u, 33.6 * u)],
           fill=CHECK, width=int(3.4 * u), joint="curve")
    for p in [(32.6, 39.2), (37.2, 43.8), (46.2, 33.6)]:
        rr = 1.7 * u
        d.ellipse([p[0] * u - rr, p[1] * u - rr, p[0] * u + rr, p[1] * u + rr], fill=CHECK)

    return img.resize((size, size), Image.LANCZOS)


def main():
    for density, size in DENSITIES.items():
        out_dir = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, "ic_launcher.png")
        render(size).save(path, "PNG", optimize=True)
        print(f"  {os.path.relpath(path, ROOT)}  {size}x{size}  {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
