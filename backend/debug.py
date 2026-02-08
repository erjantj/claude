"""
Debug script for running backend functions directly.

Usage:
    python debug.py <path_to_pdf>

Example:
    python debug.py sample.pdf
"""

import sys
import json
from pathlib import Path
import pdfplumber
import io

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(f"File not found: {pdf_path}")
        sys.exit(1)

    print(f"Loading: {pdf_path} ({pdf_path.stat().st_size / 1024:.1f} KB)")
    pdf_bytes = pdf_path.read_bytes()

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page = pdf.pages[1]
        im = page.to_image(resolution=150)
        im.debug_tablefinder()

        # Draw specific elements to understand what pdfplumber "sees":
        im.draw_rects(page.rects, stroke="red")       # rectangles/borders
        im.draw_lines(page.lines, stroke="blue")       # ruled lines

        im.show()
        # /Users/yerzhant/Downloads/Statement\ 31-MAR-22\ AC\ 13148408\ \ 02080326.pdf 


if __name__ == "__main__":
    main()
