"""Turn a LAS/LAZ crop into the compact point files the hero forest loads.

Usage:
    python tools/make_hero_clouds.py INPUT.laz KEY [--size 70] [--points 260000]

Writes assets/hero/KEY.bin and assets/hero/KEY.json.

What it does:
- normalises heights to height above ground (ground = classification 2 if present,
  otherwise the lowest points per 1 m cell, smoothed), so the camera can walk at eye level;
- crops a square of --size metres around the centre of the cloud (or --center X Y);
- thins with a random point per voxel until at most --points remain;
- stores x, y, z as uint16 centimetres plus one byte per point (1 = ground) .

File layout of KEY.bin: n*uint16 x | n*uint16 y | n*uint16 z | n*uint8 flag (little endian).
x and y run from 0 to size*100, z from 0 upwards.
Needs: pip install laspy lazrs numpy
"""
import argparse, json, os
import numpy as np
import laspy


def ground_grid(x, y, z, cls, cell=1.0):
    gx = np.floor((x - x.min()) / cell).astype(np.int64)
    gy = np.floor((y - y.min()) / cell).astype(np.int64)
    nx, ny = gx.max() + 1, gy.max() + 1
    use = cls == 2 if cls is not None and (cls == 2).sum() > 1000 else np.ones_like(x, bool)
    grid = np.full((nx, ny), np.inf)
    np.minimum.at(grid, (gx[use], gy[use]), z[use])
    # fill holes by repeated neighbour means, then smooth a little
    for _ in range(200):
        holes = ~np.isfinite(grid)
        if not holes.any():
            break
        g = np.where(np.isfinite(grid), grid, np.nan)
        p = np.pad(g, 1, constant_values=np.nan)
        nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
        with np.errstate(all="ignore"), __import__("warnings").catch_warnings():
            __import__("warnings").simplefilter("ignore")
            m = np.nanmean(nb, axis=0)
        grid[holes & np.isfinite(m)] = m[holes & np.isfinite(m)]
    grid[~np.isfinite(grid)] = np.nanmin(np.where(np.isfinite(grid), grid, np.nan))
    if cls is None or (cls == 2).sum() <= 1000:
        # lowest point per cell is noisy: take a 5x5 low percentile
        p = np.pad(grid, 2, mode="edge")
        stack = np.stack([p[i:i + nx, j:j + ny] for i in range(5) for j in range(5)])
        grid = np.percentile(stack, 20, axis=0)
    return grid[gx, gy]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("key")
    ap.add_argument("--size", type=float, default=70.0)
    ap.add_argument("--points", type=int, default=260000)
    ap.add_argument("--center", type=float, nargs=2)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "hero"))
    a = ap.parse_args()

    las = laspy.read(a.input)
    x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    cls = np.asarray(las.classification) if "classification" in las.point_format.dimension_names else None

    cx, cy = a.center if a.center else (np.median(x), np.median(y))
    h = a.size / 2
    keep = (np.abs(x - cx) <= h) & (np.abs(y - cy) <= h)
    x, y, z = x[keep], y[keep], z[keep]
    cls = cls[keep] if cls is not None else None
    size = float(min(a.size, 2 * max(np.abs(x - cx).max(), np.abs(y - cy).max())))

    hag = z - ground_grid(x, y, z, cls)
    ok = (hag > -0.5) & (hag < 90)
    x, y, hag = x[ok], y[ok], np.clip(hag[ok], 0, None)
    ground = (cls[ok] == 2) if cls is not None and (cls == 2).sum() > 1000 else (hag < 0.25)

    # random point per voxel, growing the voxel until the budget fits
    rng = np.random.default_rng(7)
    order = rng.permutation(len(x))
    x, y, hag, ground = x[order], y[order], hag[order], ground[order]
    vox = 0.05
    while True:
        k = np.stack([np.floor((x - cx) / vox), np.floor((y - cy) / vox), np.floor(hag / vox)], 1).astype(np.int64)
        _, first = np.unique(k, axis=0, return_index=True)
        if len(first) <= a.points:
            break
        vox *= 1.15
    x, y, hag, ground = x[first], y[first], hag[first], ground[first]

    q = lambda v: np.clip(np.round(v * 100), 0, 65535).astype("<u2")
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, a.key + ".bin"), "wb") as f:
        f.write(q(x - cx + size / 2).tobytes())
        f.write(q(y - cy + size / 2).tobytes())
        f.write(q(hag).tobytes())
        f.write(ground.astype("u1").tobytes())
    meta = {"n": int(len(x)), "size": round(size, 2), "zmax": round(float(np.percentile(hag, 99.5)), 2),
            "voxel": round(vox, 3), "center": [float(cx), float(cy)]}
    with open(os.path.join(a.out, a.key + ".json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(a.key, meta)


if __name__ == "__main__":
    main()
