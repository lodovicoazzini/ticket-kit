#!/usr/bin/env python3
"""Draws the Ticket Kit icons: a white ticket stub with a blue lightning bolt cut out, on a blue rounded square.

Standard library only. Run from anywhere: python3 tools/make-icons.py
Writes icons/icon16.png, icon32.png, icon48.png and icon128.png.
"""
import math
import pathlib
import struct
import zlib

BLUE = (31, 91, 209)
WHITE = (255, 255, 255)
SIZES = (16, 32, 48, 128)
SAMPLES = 4  # per axis, for anti-aliasing
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "icons"


def rounded_square(x, y, half, radius):
    qx = abs(x) - (half - radius)
    qy = abs(y) - (half - radius)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - radius


# The glyph is drawn on a 24-unit grid, placed in the middle 84 of 128 pixels (offset 22, scale 3.5),
# the same layout as the SVG drafts in the naming preview.
BOLT = [(13.0, 7.2), (8.6, 12.6), (11.6, 12.6), (10.8, 16.8), (15.4, 11.0), (12.4, 11.0)]


def inside_ticket(gx, gy):
    """A ticket stub: rounded rectangle 3..21 x 5..19 with a half-circle notch in each short side."""
    cx, cy, half_w, half_h, radius = 12.0, 12.0, 9.0, 7.0, 2.0
    qx = abs(gx - cx) - (half_w - radius)
    qy = abs(gy - cy) - (half_h - radius)
    if math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - radius > 0:
        return False
    return math.hypot(gx - 3.0, gy - 12.0) > 2.0 and math.hypot(gx - 21.0, gy - 12.0) > 2.0


def inside_polygon(x, y, points):
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def colour_at(u, v, size):
    """u and v run from -0.5 to 0.5. Returns an RGB tuple, or None outside the icon."""
    if rounded_square(u, v, 0.5, 0.22) > 0:
        return None
    # Small icons get a bigger glyph (104 of 128 pixels instead of 84) so the bolt survives at 16 pixels.
    offset, scale = (12.0, 13.0 / 3.0) if size <= 32 else (22.0, 3.5)
    gx = ((u + 0.5) * 128 - offset) / scale
    gy = ((v + 0.5) * 128 - offset) / scale
    if inside_ticket(gx, gy) and not inside_polygon(gx, gy, BOLT):
        return WHITE
    return BLUE


def render(size):
    rows = []
    n = SAMPLES * SAMPLES
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    u = (px + (sx + 0.5) / SAMPLES) / size - 0.5
                    v = (py + (sy + 0.5) / SAMPLES) / size - 0.5
                    c = colour_at(u, v, size)
                    if c is not None:
                        r += c[0]
                        g += c[1]
                        b += c[2]
                        a += 1
            if a:
                row += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n)))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows


def png(size, rows):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + row for row in rows)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    OUT_DIR.mkdir(exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icon{size}.png"
        path.write_bytes(png(size, render(size)))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
