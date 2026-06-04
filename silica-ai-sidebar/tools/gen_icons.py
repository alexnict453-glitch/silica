#!/usr/bin/env python3
"""Generate the Silica AI extension icons (a crystalline diamond mark on the
brand #181818 canvas). Pure stdlib so it runs anywhere without Pillow."""
import os
import zlib
import struct

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

BG = (24, 24, 24)        # #181818 Silica canvas
SHAPE = (138, 180, 248)  # #8ab4f8 Silica accent blue
INNER = (205, 221, 255)  # lighter facet for depth


def make_png(path, size):
    cx = cy = (size - 1) / 2.0
    r = size * 0.44
    r_in = size * 0.22
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # PNG filter type 0 for each scanline
        for x in range(size):
            d = abs(x - cx) / r + abs(y - cy) / r          # outer diamond
            d_in = abs(x - cx) / r_in + abs(y - cy) / r_in  # inner facet
            if d_in <= 1.0:
                col = INNER
            elif d <= 1.0:
                col = SHAPE
            else:
                col = BG
            raw += bytes(col)

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        make_png(os.path.join(OUT, f"icon{size}.png"), size)
        print(f"wrote icon{size}.png")


if __name__ == "__main__":
    main()
