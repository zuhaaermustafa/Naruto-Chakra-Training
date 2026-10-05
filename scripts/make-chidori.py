#!/usr/bin/env python3
"""
Rebuild a pixelated Chidori GIF as a smooth, menacing glow-on-black video.

  python3 scripts/make-chidori.py scripts/chidori-source.gif src/assets/chidori.mp4 --frames 24
  (needs Python 3 with numpy, opencv-python, scipy, pillow, and ffmpeg)
  options: [--frames N] [--keyframe SECONDS] [--preview N]

What it does for every GIF frame:
  1. Smooths the 1-bit, noisy outline (the "hairy" dithered edge) at higher resolution.
  2. Re-colours the shape: white-hot core fading to electric blue at the edges.
  3. Adds a layered glow (bloom) around it.
  4. Adds thin, randomly crackling lightning arcs that change every output frame.
  5. Fades the arcs that the original GIF cut off at its top/bottom edge.
The result is white-and-blue light on black, which chidori.js turns into transparency.
"""
import argparse, math, os, subprocess, sys, shutil, tempfile
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

# ------------------------- tweak these -------------------------
SCALE = 1.5                 # upscale factor over the GIF
CROP = (50, -15, 1250, 785) # x0, y0, x1, y1 in GIF pixels, centred on the core (may exceed the frame)
OUT_FPS = 40                # GIF is 20 fps; each GIF frame is shown twice with a fresh glow/arcs
EDGE_SIGMA = 3.2            # smoothing of the jagged outline (hi-res px)
RIM = (0.16, 0.50, 1.00)    # electric blue at the edge (R, G, B, 0..1)
MID = (0.55, 0.88, 1.00)
CORE = (1.00, 1.00, 1.00)
GLOW = (0.20, 0.52, 1.00)   # colour of the outer aura
GLOW_STRENGTH = 1.0
ARCS = 7                    # extra crackling bolts per output frame
ARC_STRENGTH = 0.85
CRF = 17                    # H.264 quality (lower = bigger file, fewer banding artefacts)
# ----------------------------------------------------------------

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def ramp(e):
    """Map energy 0..1 to a blue -> cyan -> white colour, returns HxWx3."""
    e = e[..., None]
    rim, mid, core = (np.array(c, np.float32) for c in (RIM, MID, CORE))
    lo = rim + (mid - rim) * np.clip(e / 0.55, 0, 1)
    hi = mid + (core - mid) * np.clip((e - 0.55) / 0.45, 0, 1)
    return np.where(e < 0.55, lo, hi)

def make_plasma(seed, sigma, size=(1400, 2000)):
    """Zero-mean, unit-std smooth noise used for crawling plasma veins."""
    r = np.random.default_rng(seed)
    n = cv2.GaussianBlur(r.normal(0, 1, size).astype(np.float32), (0, 0), sigma)
    return (n / n.std()).astype(np.float32)

plasma_a = make_plasma(11, 9)
plasma_b = make_plasma(23, 19)

def load_frames(path):
    im = Image.open(path)
    frames = []
    for i in range(im.n_frames):
        im.seek(i)
        frames.append(np.array(im.convert("RGBA")))
    return frames

def crop_pad(a, box):
    """Crop a HxWx4 array to a box that may extend past the frame (padding with transparent)."""
    x0, y0, x1, y1 = box
    out = np.zeros((y1 - y0, x1 - x0, a.shape[2]), a.dtype)
    sx0, sy0 = max(x0, 0), max(y0, 0)
    sx1, sy1 = min(x1, a.shape[1]), min(y1, a.shape[0])
    out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = a[sy0:sy1, sx0:sx1]
    return out

def jagged_bolt(rng, p0, p1, depth, spread):
    """Midpoint-displacement polyline from p0 to p1."""
    pts = [np.array(p0, np.float32), np.array(p1, np.float32)]
    for _ in range(depth):
        nxt = []
        for a, b in zip(pts[:-1], pts[1:]):
            mid = (a + b) / 2
            d = b - a
            n = np.array([-d[1], d[0]], np.float32)
            n /= (np.linalg.norm(n) + 1e-6)
            mid = mid + n * rng.normal(0, spread * np.linalg.norm(d))
            nxt += [a, mid]
        nxt.append(pts[-1])
        pts = nxt
    return pts

def draw_arcs(shape_hw, core_xy, rng, count):
    """Thin white-blue crackling bolts radiating from the core. Returns (hot, wide) float masks."""
    h, w = shape_hw
    hot = np.zeros((h, w), np.uint8)
    wide = np.zeros((h, w), np.uint8)
    cx, cy = core_xy
    for _ in range(count):
        ang = rng.uniform(0, 2 * math.pi)
        reach = rng.uniform(0.18, 0.46) * w
        start = (cx + rng.normal(0, 18), cy + rng.normal(0, 18))
        end = (cx + math.cos(ang) * reach, cy + math.sin(ang) * reach * 0.8)
        pts = jagged_bolt(rng, start, end, depth=6, spread=0.16)
        poly = np.array(pts, np.int32).reshape(-1, 1, 2)
        th = int(rng.integers(2, 4))
        cv2.polylines(hot, [poly], False, 255, th, cv2.LINE_AA)
        cv2.polylines(wide, [poly], False, 255, th + 5, cv2.LINE_AA)
        # one or two forks
        for _ in range(int(rng.integers(1, 3))):
            k = int(rng.integers(len(pts) // 4, 3 * len(pts) // 4))
            fa = ang + rng.uniform(-0.9, 0.9)
            fr = reach * rng.uniform(0.2, 0.4)
            fe = (pts[k][0] + math.cos(fa) * fr, pts[k][1] + math.sin(fa) * fr)
            sub = jagged_bolt(rng, pts[k], fe, depth=5, spread=0.18)
            sp = np.array(sub, np.int32).reshape(-1, 1, 2)
            cv2.polylines(hot, [sp], False, 220, 1, cv2.LINE_AA)
            cv2.polylines(wide, [sp], False, 200, 4, cv2.LINE_AA)
    return hot.astype(np.float32) / 255, wide.astype(np.float32) / 255

def render_frame(rgba, src_edge_rows, sub_index, frame_index):
    """rgba: cropped HxWx4 uint8 (GIF resolution). Returns HxWx3 float in 0..1 at hi-res."""
    h0, w0 = rgba.shape[:2]
    H, W = int(round(h0 * SCALE)), int(round(w0 * SCALE))
    rng = np.random.default_rng(frame_index * 2 + sub_index)

    a_bin = (rgba[..., 3] > 0).astype(np.float32)
    rgb = rgba[..., :3].astype(np.float32) / 255

    # --- 1. smooth the outline ---
    # median removes the dithered "hair" and isolated specks, then a soft threshold gives a clean edge
    a_clean = cv2.medianBlur((a_bin * 255).astype(np.uint8), 5).astype(np.float32) / 255
    a_up = cv2.resize(a_clean, (W, H), interpolation=cv2.INTER_CUBIC)
    a_up = cv2.GaussianBlur(a_up, (0, 0), EDGE_SIGMA)
    mask = smoothstep(0.42, 0.58, a_up)

    # --- fade where the GIF cut the picture off at its top/bottom edge ---
    top, bottom = src_edge_rows            # rows (hi-res) where the original frame starts/ends
    yy = np.arange(H, dtype=np.float32)[:, None]
    fade = smoothstep(top + 6, top + 130, yy) * (1 - smoothstep(bottom - 130, bottom - 6, yy))
    mask = mask * fade

    # --- interior detail from the GIF (swirl + soft highlight), without dark fringes ---
    w_ = a_bin[..., None]
    num = cv2.GaussianBlur(rgb * w_, (0, 0), 2.0)
    den = cv2.GaussianBlur(w_[..., 0], (0, 0), 2.0)[..., None]
    rgb_f = num / np.maximum(den, 1e-3)
    lum = rgb_f.max(axis=2)
    lum_up = cv2.resize(lum, (W, H), interpolation=cv2.INTER_CUBIC)
    lum_up = cv2.GaussianBlur(lum_up, (0, 0), 1.3)

    # --- 2. energy: bright spine on thin arcs, blue body with a hot core and crawling plasma veins ---
    dist = ndi.distance_transform_edt(mask > 0.5).astype(np.float32)
    local_max = ndi.maximum_filter(dist, size=61)
    norm = np.clip(dist / np.maximum(local_max, 1.0), 0, 1)       # 0 at the edge, 1 along the middle of any stroke
    thin = 1.0 - smoothstep(10, 22, local_max)                      # 1 on arcs, 0 inside the big blob
    body = smoothstep(0.84, 1.0, lum_up) * smoothstep(8, 40, dist)  # the white-hot centre painted into the GIF
    dark = np.clip((lum_up - 0.72) * 1.3, -0.30, 0.20)              # the GIF's darker internal patches
    t = sub_index + 2 * frame_index                                  # output frame number, drives the drifting plasma
    fa = plasma_a[(t * 5) % 200:(t * 5) % 200 + H, (t * 3) % 200:(t * 3) % 200 + W]
    fb = plasma_b[(t * -4) % 200:(t * -4) % 200 + H, (t * 6) % 200:(t * 6) % 200 + W]
    veins = np.maximum(np.exp(-(fa / 0.32) ** 2), np.exp(-(fb / 0.28) ** 2))
    veins = veins * smoothstep(5, 24, dist) * (1 - thin)
    energy = 0.12 + 0.28 * norm ** 1.3 + dark * (1 - thin)
    energy = energy + thin * (0.34 + 0.34 * norm) + 0.46 * body + 0.40 * veins
    energy = np.clip(energy, 0, 1)

    img = ramp(energy) * (mask * (0.62 + 0.38 * energy))[..., None]

    # --- 3. glow / bloom ---
    src = (mask * (0.35 + 0.65 * energy ** 1.5))
    g = (cv2.GaussianBlur(src, (0, 0), 6) * 0.80
         + cv2.GaussianBlur(src, (0, 0), 20) * 0.50
         + cv2.GaussianBlur(src, (0, 0), 60) * 0.38)
    glow = g[..., None] * np.array(GLOW, np.float32) * GLOW_STRENGTH
    # white-hot halo right around the brightest parts
    hot_halo = cv2.GaussianBlur(mask * body, (0, 0), 14)[..., None] * 0.45

    # --- 4. crackling arcs ---
    # core position: brightest region of this frame
    ys, xs = np.where(body * mask > 0.6)
    core_xy = (xs.mean(), ys.mean()) if len(xs) > 50 else (W / 2, H / 2)
    hot, wide = draw_arcs((H, W), core_xy, rng, ARCS)
    hot = cv2.GaussianBlur(hot, (0, 0), 0.8)
    aura = cv2.GaussianBlur(wide, (0, 0), 6)
    arcs = (hot[..., None] * np.array([0.95, 0.99, 1.0], np.float32)
            + aura[..., None] * np.array(GLOW, np.float32) * 0.9) * ARC_STRENGTH * (0.75 + 0.25 * rng.random())

    # --- 5. combine with a soft shoulder so highlights roll off instead of clipping flat ---
    out = img + glow + hot_halo * np.array([0.7, 0.9, 1.0], np.float32) + arcs
    out = 1.0 - np.exp(-1.35 * out)
    out = out / (1.0 - math.exp(-1.35))
    return np.clip(out, 0, 1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gif"); ap.add_argument("out")
    ap.add_argument("--preview", type=int, default=None, help="render just this GIF frame to PNG and exit")
    ap.add_argument("--frames", type=int, default=None, help="only use the first N GIF frames (default: all)")
    ap.add_argument("--keyframe", type=float, default=None,
                    help="force a video keyframe at this time (seconds) so the page can loop back to it instantly")
    args = ap.parse_args()

    frames = load_frames(args.gif)
    if args.frames:
        frames = frames[:args.frames]
    x0, y0, x1, y1 = CROP
    # where the original picture ends inside the crop, in hi-res rows (for the edge fade)
    src_top = max(0, -y0) * SCALE
    src_bottom = (frames[0].shape[0] - y0) * SCALE
    cropped = [crop_pad(f, CROP) for f in frames]

    if args.preview is not None:
        f = render_frame(cropped[args.preview], (src_top, src_bottom), 0, args.preview)
        Image.fromarray((f * 255).astype(np.uint8)).save(args.out)
        print("preview saved", f.shape)
        return

    tmp = tempfile.mkdtemp(prefix="chidori_")
    try:
        n = 0
        for i, c in enumerate(cropped):
            for sub in range(OUT_FPS // 20):
                f = render_frame(c, (src_top, src_bottom), sub, i)
                # tiny noise before 8-bit quantising avoids visible banding in the dark glow gradients
                f = f + np.random.default_rng(n).normal(0, 0.7 / 255, f.shape).astype(np.float32)
                Image.fromarray((np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(tmp, f"f{n:04d}.png"))
                n += 1
            print(f"\rframe {i + 1}/{len(cropped)}", end="", flush=True)
        print()
        cmd = ["ffmpeg", "-v", "error", "-y", "-framerate", str(OUT_FPS), "-i", os.path.join(tmp, "f%04d.png"),
               "-c:v", "libx264", "-preset", "slow", "-crf", str(CRF), "-pix_fmt", "yuv420p",
               "-profile:v", "high", "-movflags", "+faststart", "-an"]
        if args.keyframe is not None:
            cmd += ["-force_key_frames", f"{args.keyframe:.4f}"]
        subprocess.check_call(cmd + [args.out])
        print("wrote", args.out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
