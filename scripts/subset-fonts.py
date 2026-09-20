"""Subset + convert the self-hosted Inter fonts to woff2.

Run from the repository root:

    python scripts/subset-fonts.py

What it does:
  * takes the Inter 18pt static TTFs from `public/fonts/` (the optical size that
    matches UI text), subsets them to the Latin ranges Google Fonts ships, and
    writes `Inter-<Weight>.woff2` next to them;
  * deletes every `.ttf` afterwards, so the repo only carries the ~6 small files
    the app actually serves.

Why the 18pt cut: Inter 4.x ships three optical sizes (18/24/28pt). 18pt is the
closest match for 13–18px UI text, and using one family keeps the page weight
low. The 24pt/28pt files are display cuts and are not used by this design.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

FONT_DIR = pathlib.Path("public/fonts")

# Latin subset ranges (same set Google Fonts serves for `latin`).
UNICODES = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
    "U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,"
    "U+2215,U+FEFF,U+FFFD"
)

# source TTF -> destination woff2 (names are referenced by src/app/globals.css)
TARGETS = {
    "Inter_18pt-Regular.ttf": "Inter-Regular.woff2",
    "Inter_18pt-Italic.ttf": "Inter-Italic.woff2",
    "Inter_18pt-Medium.ttf": "Inter-Medium.woff2",
    "Inter_18pt-SemiBold.ttf": "Inter-SemiBold.woff2",
    "Inter_18pt-Bold.ttf": "Inter-Bold.woff2",
    "Inter_18pt-ExtraBold.ttf": "Inter-ExtraBold.woff2",
}


def convert(source: pathlib.Path, destination: pathlib.Path) -> None:
    command = [
        sys.executable,
        "-m",
        "fontTools.subset",
        str(source),
        f"--output-file={destination}",
        "--flavor=woff2",
        f"--unicodes={UNICODES}",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
    ]
    subprocess.run(command, check=True)


def main() -> int:
    if not FONT_DIR.is_dir():
        print(f"!! {FONT_DIR} does not exist", file=sys.stderr)
        return 1

    converted: list[pathlib.Path] = []
    missing: list[str] = []

    for source_name, target_name in TARGETS.items():
        source = FONT_DIR / source_name
        if not source.exists():
            missing.append(source_name)
            continue
        destination = FONT_DIR / target_name
        convert(source, destination)
        converted.append(destination)
        print(f"  {source_name} -> {target_name} ({destination.stat().st_size / 1024:.1f} KB)")

    if missing:
        print(f"!! missing source files: {', '.join(missing)}", file=sys.stderr)

    removed = 0
    for ttf in FONT_DIR.glob("*.ttf"):
        ttf.unlink()
        removed += 1
    print(f"removed {removed} .ttf files; {len(converted)} woff2 files ready")

    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())