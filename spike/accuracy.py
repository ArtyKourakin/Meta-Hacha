#!/usr/bin/env python3
"""Throwaway accuracy probe: locate Godot UI targets in screenshots.

For each case in cases.json, sends the screenshot to muse-spark-1.3 via the
Meta Model API, draws the predicted point on a copy of the image in spike/out/,
and prints one result line per case plus a summary.

Usage:
    spike/.venv/bin/python spike/accuracy.py [--normalized]
"""

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent
CASES_PATH = BASE / "cases.json"
SCREENS_DIR = BASE / "screens"
OUT_DIR = BASE / "out"

MODEL = "muse-spark-1.3"
BASE_URL = "https://api.meta.ai/v1"
SECRETS_PATH = os.path.expanduser("~/.secrets/game-agent.env")


def build_prompt(target, w, h, normalized):
    size = f"Image size: {w} pixels wide, {h} pixels tall."
    if normalized:
        coords = (
            '"x","y": integers on a 0-1000 scale for the CENTER of the target, '
            "where (0,0) is the top-left corner of the image and (1000,1000) is "
            "the bottom-right corner. If not found, use 0,0."
        )
    else:
        coords = (
            '"x","y": integers in IMAGE PIXELS for the CENTER of the target. '
            "(0,0) is the top-left corner, x increases to the right, "
            "y increases downward. If not found, use 0,0."
        )
    return (
        "You are locating a UI element in a screenshot.\n"
        f"{size}\n"
        f"Target: {target}\n"
        "Return ONLY a single JSON object, no other text, with this exact shape: "
        '{"found": true/false, "x": <int>, "y": <int>, '
        '"confidence": "high"|"medium"|"low"}\n'
        '- "found": true if the target is visible in the image, else false.\n'
        f"- {coords}\n"
        '- "confidence": your confidence in the location.\n'
    )


def parse_response(text):
    """Extract (found, x, y, confidence) from a model response. Raises on failure."""
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`").strip()
        if t.lower().startswith("json"):
            t = t[4:].strip()
    obj = json.loads(t)
    found = bool(obj["found"])
    x = int(obj["x"])
    y = int(obj["y"])
    conf = str(obj["confidence"])
    if conf not in ("high", "medium", "low"):
        raise ValueError(f"bad confidence: {conf!r}")
    return found, x, y, conf


def annotate(img, x, y, lines, draw_circle):
    """Draw a red circle at (x, y) and label lines in the top-left corner."""
    d = ImageDraw.Draw(img)
    if draw_circle:
        r = max(10, min(img.width, img.height) // 50)
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 0, 0), width=3)
    font = ImageFont.load_default()
    ascent, descent = font.getmetrics()
    lh = ascent + descent + 2
    box_w = max(d.textlength(t, font=font) for t in lines)
    box_h = lh * len(lines)
    d.rectangle([4, 4, 4 + box_w + 12, 4 + box_h + 8], fill=(0, 0, 0))
    yy = 8
    for t in lines:
        d.text((10, yy), t, font=font, fill=(255, 255, 255))
        yy += lh


def main():
    ap = argparse.ArgumentParser(description="Probe muse-spark UI-element accuracy.")
    ap.add_argument(
        "--normalized",
        action="store_true",
        help="ask for 0-1000 coordinates and convert back to pixels",
    )
    args = ap.parse_args()
    mode = "norm" if args.normalized else "px"

    load_dotenv(SECRETS_PATH)
    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        print(
            "error: MODEL_API_KEY is not set "
            "(expected in ~/.secrets/game-agent.env)",
            file=sys.stderr,
        )
        return 1
    client = OpenAI(base_url=BASE_URL, api_key=api_key)

    cases = json.loads(CASES_PATH.read_text())
    OUT_DIR.mkdir(exist_ok=True)

    n_found = n_oob = n_parse_err = n_api_err = 0
    times = []
    for i, case in enumerate(cases):
        fname = case["file"]
        target = case["target"]
        try:
            img = Image.open(SCREENS_DIR / fname).convert("RGB")
        except Exception as e:
            print(f"{i} {fname} | {target} | IMAGE_ERROR {e}", flush=True)
            n_api_err += 1
            continue
        w, h = img.size
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        prompt = build_prompt(target, w, h, args.normalized)

        t0 = time.perf_counter()
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                temperature=0,
                # Reasoning models spend most of this budget on hidden
                # reasoning tokens; too small a cap yields empty content.
                max_tokens=2000,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{b64}"
                                },
                            },
                        ],
                    }
                ],
            )
        except Exception as e:
            dt = time.perf_counter() - t0
            print(
                f"{i} {fname} | {target} | "
                f"API_ERROR {type(e).__name__}: {e} t={dt:.1f}s",
                flush=True,
            )
            n_api_err += 1
            continue
        dt = time.perf_counter() - t0
        times.append(dt)
        finish = resp.choices[0].finish_reason
        text = (resp.choices[0].message.content or "").strip()

        try:
            found, rx, ry, conf = parse_response(text)
        except Exception as e:
            print(
                f"{i} {fname} | {target} | "
                f"PARSE_ERROR {e} t={dt:.1f}s finish={finish} "
                f"raw={text[:120]!r}",
                flush=True,
            )
            n_parse_err += 1
            continue

        if args.normalized:
            oob = not (0 <= rx <= 1000 and 0 <= ry <= 1000)
            px = round(rx / 1000 * w)
            py = round(ry / 1000 * h)
            coord_str = f"raw=({rx},{ry}) px=({px},{py})"
        else:
            oob = not (0 <= rx < w and 0 <= ry < h)
            px, py = rx, ry
            coord_str = f"x={px} y={py}"

        # Clamp only for drawing; the printed coordinates stay raw.
        cx = min(max(px, 0), w - 1)
        cy = min(max(py, 0), h - 1)
        status = f"found={found} {coord_str} conf={conf}"
        if not found:
            status += " NOT_FOUND"
        if oob:
            status += " OUT_OF_BOUNDS"
        ann = img.copy()
        annotate(ann, cx, cy, [target[:100], status[:120]], draw_circle=found)
        stem = Path(fname).stem
        ann.save(OUT_DIR / f"{stem}_{i}_{mode}.png")

        if found:
            n_found += 1
        if oob:
            n_oob += 1
        flags = " OUT_OF_BOUNDS" if oob else ""
        print(
            f"{i} {fname} | {target} | "
            f"found={found} {coord_str} conf={conf} t={dt:.1f}s{flags}",
            flush=True,
        )

    avg = sum(times) / len(times) if times else 0.0
    print("---")
    print(
        f"cases={len(cases)} found={n_found} out_of_bounds={n_oob} "
        f"parse_errors={n_parse_err} api_errors={n_api_err} avg_t={avg:.1f}s"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
