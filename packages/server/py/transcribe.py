#!/usr/bin/env python3
"""Local transcription with faster-whisper. Prints JSON: {"language": "de", "words": [{"text","t0","t1"}]}.
usage: transcribe.py <audio_or_video> <model> <language|auto> <models_dir>
"""
import json
import subprocess
import sys

import numpy as np

try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "faster-whisper ist nicht installiert. Installieren: pip install faster-whisper"}))
    sys.exit(3)

path, model_name, lang, models_dir = sys.argv[1:5]
# Decode with ffmpeg ourselves (16 kHz mono float32). Avoids PyAV version conflicts entirely.
pcm = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
    check=True, capture_output=True,
).stdout
audio = np.frombuffer(pcm, dtype=np.float32)

model = WhisperModel(model_name, device="cpu", compute_type="int8", download_root=models_dir)
segments, info = model.transcribe(audio, language=None if lang == "auto" else lang, word_timestamps=True, vad_filter=True)
words = []
for seg in segments:
    for w in seg.words or []:
        text = w.word.strip()
        if text:
            words.append({"text": text, "t0": round(w.start, 3), "t1": round(w.end, 3)})
print(json.dumps({"language": info.language, "words": words}, ensure_ascii=False))
