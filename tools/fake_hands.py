"""Send two synthetic hands over OSC the way handtrack does, for tests without a camera.

    ../handtrack/.venv/Scripts/python tools/fake_hands.py [seconds] [--curl 0.3] [--rsize 0.35]

The right hand sweeps sideways across the picture and dips toward the camera
mid-sweep; the left hand rests at the left with its fingers half closed.
Landmarks are MediaPipe world coordinates: metres round the hand, x right in
the mirrored image, y down, z away from the webcam, palm facing the webcam.
"""
import math
import sys
import time

from pythonosc.udp_client import SimpleUDPClient

# knuckle x positions for index..little on a left hand seen palm-on in the mirror
# (the thumb is on +x); a right hand is the mirror image
KNUCKLES = [0.026, 0.004, -0.016, -0.034]
SEGMENTS = [[0.040, 0.025, 0.022], [0.044, 0.028, 0.024], [0.041, 0.027, 0.023], [0.032, 0.020, 0.020]]


def hand(side, curl, spread=0.0):
    """21 landmarks for an upright hand, palm toward the camera."""
    s = 1.0 if side == "left" else -1.0
    pts = [(0.0, 0.075, 0.0)]                              # wrist
    # thumb: out to the side and forward
    tc = [(0.022, 0.058, -0.010), (0.042, 0.035, -0.022), (0.056, 0.012, -0.030), (0.064, -0.006, -0.034)]
    for x, y, z in tc:
        pts.append((x * s, y, z - curl * 0.01))
    for f, kx in enumerate(KNUCKLES):
        x, y, z = kx * s, -0.010, 0.0
        pts.append((x, y, z))
        ang = 0.0
        fan = (f - 1.5) * spread
        for seg in SEGMENTS[f]:
            ang += curl * 1.1                              # each joint bends toward the palm side (-z)
            x += math.sin(fan) * seg * s
            y -= math.cos(ang) * seg
            z -= math.sin(ang) * seg
            pts.append((x, y, z))
    return pts


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else 6.0
    curl = 0.25
    if "--curl" in sys.argv:
        curl = float(sys.argv[sys.argv.index("--curl") + 1])
    rsize_fixed = float(sys.argv[sys.argv.index("--rsize") + 1]) if "--rsize" in sys.argv else None
    c = SimpleUDPClient("127.0.0.1", 9000)
    t0 = time.monotonic()
    for label in ("left", "right"):
        c.send_message(f"/hand/{label}/present", 1)
    while (t := time.monotonic() - t0) < seconds:
        c.send_message("/hands/alive", 1)
        # right: sweep across, nearer the camera (bigger) in the middle of the sweep
        u = 0.5 + 0.5 * math.sin(t * 1.1)
        rx, ry = 0.40 + 0.35 * u, 0.55
        rsize = 0.22 * (1.0 + 0.35 * math.sin(math.pi * u))
        if rsize_fixed is not None:
            rsize = rsize_fixed
        frames = {"right": (rx, ry, rsize, hand("right", 0.12, 0.08)),
                  "left": (0.28, 0.50, 0.22, hand("left", curl, 0.05))}
        for label, (x, y, size, pts) in frames.items():
            p = f"/hand/{label}"
            c.send_message(f"{p}/pos", [x, y, size])
            c.send_message(f"{p}/open", 1.0 - curl)
            c.send_message(f"{p}/gesture", "open")
            c.send_message(f"{p}/world", [v for pt in pts for v in pt])
        time.sleep(1 / 30)
    for label in ("left", "right"):
        c.send_message(f"/hand/{label}/present", 0)


if __name__ == "__main__":
    main()
