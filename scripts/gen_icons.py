"""Generate KhartoumMap PWA icons (192x192 and 512x512) procedurally.
Produces real PNG bytes with a green disc on dark background, maskable.
"""
import struct
import zlib
from pathlib import Path


def make_png(w: int, h: int, bg=(26, 86, 50), disc=(255, 255, 255)) -> bytes:
    raw = bytearray()
    cx, cy = w / 2.0, h / 2.0
    r2_outer = (min(w, h) * 0.48) ** 2
    r2_inner = (min(w, h) * 0.30) ** 2
    for y in range(h):
        raw.append(0)  # filter type 'none' per scanline
        for x in range(w):
            dx, dy = x - cx, y - cy
            d2 = dx * dx + dy * dy
            if d2 > r2_outer:
                r, g, b = 0, 0, 0
            elif d2 < r2_inner:
                r, g, b = disc
            else:
                r, g, b = bg
            raw.extend([r, g, b])

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def main():
    here = Path(__file__).resolve().parent.parent  # khartoum-map/
    icons = here / "icons"
    icons.mkdir(exist_ok=True)
    for size, name in [(192, "icon-192.png"), (512, "icon-512.png")]:
        p = icons / name
        p.write_bytes(make_png(size, size, bg=(26, 86, 50)))
        print(f"wrote {p} ({p.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
