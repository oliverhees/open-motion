#!/usr/bin/env python3
"""Creates placeholder assets for the example (no real recordings needed).

  assets/facecam.mp4   13 s talking-head placeholder with a "voice" tone
  assets/music.mp3     quiet chord pad
  assets/image.png      flat landscape, stands in for an AI image
  assets/fonts/        Bricolage Grotesque (SIL Open Font License)

Needs: python3 + Pillow, ffmpeg. Replace the files with your own anytime.
"""
import math
import pathlib
import subprocess
import urllib.request

from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).parent
ASSETS = HERE / "assets"
FONTS = ASSETS / "fonts"
ASSETS.mkdir(exist_ok=True)
FONTS.mkdir(exist_ok=True)

DURATION = 13
FPS = 30
W, H = 1280, 720


def facecam():
    out = ASSETS / "facecam.mp4"
    voice = "0.35*sin(2*PI*170*t)*(0.55+0.45*sin(2*PI*3.1*t))*(0.6+0.4*sin(2*PI*0.7*t))"
    ff = subprocess.Popen(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
            "-f", "lavfi", "-i", f"aevalsrc={voice}:s=48000:d={DURATION}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-g", str(FPS),
            "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(out),
        ],
        stdin=subprocess.PIPE,
    )
    for i in range(DURATION * FPS):
        t = i / FPS
        img = Image.new("RGB", (W, H), (28, 52, 74))
        d = ImageDraw.Draw(img)
        d.rectangle([0, int(H * 0.72), W, H], fill=(22, 41, 59))
        bob = math.sin(t * 2.2) * 6
        sway = math.sin(t * 0.9) * 10
        cx, cy = W / 2 + sway, H * 0.42 + bob
        d.ellipse([cx - 330, cy + 150, cx + 330, cy + 620], fill=(249, 114, 22))
        d.ellipse([cx - 120, cy - 150, cx + 120, cy + 150], fill=(236, 206, 178))
        mouth = 6 + abs(math.sin(t * 9.7)) * 16
        d.ellipse([cx - 34, cy + 62 - mouth / 2, cx + 34, cy + 62 + mouth / 2], fill=(120, 60, 50))
        d.ellipse([cx - 60, cy - 20, cx - 36, cy + 4], fill=(40, 40, 50))
        d.ellipse([cx + 36, cy - 20, cx + 60, cy + 4], fill=(40, 40, 50))
        d.rounded_rectangle([24, 24, 300, 70], radius=10, fill=(0, 0, 0))
        d.text((40, 36), f"FACECAM  {t:5.2f}s", fill=(255, 255, 255))
        ff.stdin.write(img.tobytes())
    ff.stdin.close()
    ff.wait()
    print("facecam.mp4")


def music():
    chord = "+".join(f"sin(2*PI*{f}*t)" for f in (220.0, 277.18, 329.63, 440.0))
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi",
            "-i", f"aevalsrc=0.06*({chord})*(0.8+0.2*sin(2*PI*0.25*t)):s=48000:d={DURATION}",
            "-af", f"afade=t=in:d=1.5,afade=t=out:st={DURATION - 2}:d=2",
            "-c:a", "libmp3lame", "-b:a", "128k", str(ASSETS / "music.mp3"),
        ],
        check=True,
    )
    print("music.mp3")


def bild():
    img = Image.new("RGB", (1200, 800), (133, 183, 235))
    d = ImageDraw.Draw(img)
    d.ellipse([820, 110, 980, 270], fill=(250, 199, 117))
    d.polygon([(0, 800), (380, 300), (720, 800)], fill=(15, 110, 86))
    d.polygon([(420, 800), (840, 250), (1200, 680), (1200, 800)], fill=(29, 158, 117))
    d.rectangle([0, 640, 1200, 800], fill=(55, 138, 221))
    for y in range(660, 800, 22):
        d.line([(80, y), (1120, y)], fill=(133, 183, 235), width=3)
    img.save(ASSETS / "image.png")
    print("image.png")


def font():
    url = "https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9K6as8bTXq_nANBjzKo3IeZx8z6up5BeSl9D4dj_x9PpZBMlGIInE.woff2"
    lic = "https://raw.githubusercontent.com/google/fonts/main/ofl/bricolagegrotesque/OFL.txt"
    target = FONTS / "bricolage-grotesque-latin.woff2"
    if not target.exists():
        urllib.request.urlretrieve(url, target)
    try:
        urllib.request.urlretrieve(lic, FONTS / "OFL.txt")
    except Exception as e:  # license file is nice to have, font still works
        print("could not fetch OFL.txt:", e)
    print("fonts/bricolage-grotesque-latin.woff2")


if __name__ == "__main__":
    font()
    bild()
    music()
    facecam()
