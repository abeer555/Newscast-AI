#!/usr/bin/env python3
"""
Kokoro local TTS server — exposes a minimal HTTP API so the Next.js app can
generate audio without any cloud round-trip.

Usage:
  source /home/abeer/Downloads/git/.venv/bin/activate.fish
  python scripts/kokoro_server.py [--port 8880]

Endpoints:
  POST /tts
    Body (JSON): { "text": "...", "voice": "af_heart", "speed": 1.0 }
    Response:    audio/wav  (binary WAV, 24kHz mono)

  GET /health
    Response:    200 OK  { "status": "ok" }
"""

import argparse
import io
import json
import warnings
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

# Silence Kokoro's harmless startup noise
warnings.filterwarnings("ignore", message="dropout option adds dropout")
warnings.filterwarnings("ignore", message=".*weight_norm.*is deprecated")

import numpy as np
import soundfile as sf
from kokoro import KPipeline

# ── Pipeline cache (one per lang_code, lazy-init) ───────────────────────────
_pipelines: dict[str, KPipeline] = {}

def get_pipeline(lang_code: str) -> KPipeline:
    if lang_code not in _pipelines:
        print(f"[kokoro] loading pipeline lang_code={lang_code!r} …", flush=True)
        _pipelines[lang_code] = KPipeline(lang_code=lang_code)
        print(f"[kokoro] pipeline ready ({lang_code})", flush=True)
    return _pipelines[lang_code]

def voice_to_lang(voice: str) -> str:
    """Infer Kokoro lang_code from the voice prefix letter."""
    prefix = voice[0].lower() if voice else "a"
    mapping = {
        "a": "a",   # American English
        "b": "b",   # British English
        "j": "j",   # Japanese
        "z": "z",   # Mandarin
        "e": "e",   # Spanish
        "f": "f",   # French
        "h": "h",   # Hindi
        "i": "i",   # Italian
        "p": "p",   # Brazilian Portuguese
    }
    return mapping.get(prefix, "a")

def synthesize(text: str, voice: str, speed: float = 1.0) -> bytes:
    lang = voice_to_lang(voice)
    pipeline = get_pipeline(lang)
    chunks = []
    for _, _, audio in pipeline(text, voice=voice, speed=speed):
        chunks.append(audio)
    combined = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    buf = io.BytesIO()
    sf.write(buf, combined, 24000, format="WAV")
    return buf.getvalue()


# ── HTTP handler ─────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter logs
        print(f"[kokoro] {self.address_string()} {fmt % args}", flush=True)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/tts":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            text  = data.get("text", "").strip()
            voice = data.get("voice", "af_heart")
            speed = float(data.get("speed", 1.0))
            if not text:
                self._json(400, {"error": "text is required"})
                return
            wav = synthesize(text, voice, speed)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
        except Exception as e:
            print(f"[kokoro] ERROR: {e}", file=sys.stderr, flush=True)
            self._json(500, {"error": str(e)})

    def _json(self, code: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Kokoro local TTS server")
    parser.add_argument("--port", type=int, default=8880, help="Port to listen on (default: 8880)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    args = parser.parse_args()

    # Pre-warm the American English pipeline on startup so the first request is fast
    get_pipeline("a")

    print(f"[kokoro] listening on http://{args.host}:{args.port}", flush=True)
    HTTPServer((args.host, args.port), Handler).serve_forever()
