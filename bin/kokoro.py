"""Reads text aloud with a Kokoro TTS server (optional; set "kokoro" in ~/.claude/gg.json).

usage: python3 kokoro.py <server url> <voice id> <speed> <text>
The text is cut into sentences: the first one plays while the next is being made, so it
starts fast and flows. Expects the server's POST /wav {texto, voz, velocidad} -> {archivo}.
"""
import json
import os
import queue
import re
import subprocess
import sys
import threading
import urllib.request


def wav(url, voz, velocidad, frase):
    try:
        req = urllib.request.Request(
            url.rstrip("/") + "/wav",
            json.dumps({"texto": frase, "voz": voz, "tono": 1.0, "velocidad": velocidad}).encode(),
            {"Content-Type": "application/json"},
        )
        archivo = json.loads(urllib.request.urlopen(req, timeout=60).read()).get("archivo")
        return archivo if archivo and os.path.exists(archivo) else None
    except (OSError, ValueError):
        return None


def frases(texto, tope=220):
    partes, actual = [], ""
    for f in re.split(r"(?<=[.!?;:…])\s+", texto):
        if actual and len(actual) + len(f) > tope:
            partes.append(actual)
            actual = f
        else:
            actual = (actual + " " + f).strip()
    if actual:
        partes.append(actual)
    return partes


def main():
    if len(sys.argv) < 5:
        return
    url, voz, velocidad, texto = sys.argv[1], sys.argv[2], float(sys.argv[3]), " ".join(sys.argv[4:])
    velocidad = max(0.8, min(1.6, velocidad))
    listos = queue.Queue(maxsize=2)

    def preparar():
        for frase in frases(texto):
            archivo = wav(url, voz, velocidad, frase)
            if archivo:
                listos.put(archivo)
        listos.put(None)

    threading.Thread(target=preparar, daemon=True).start()
    while True:
        archivo = listos.get()
        if archivo is None:
            break
        subprocess.run(["afplay", archivo], check=False)
        try:
            os.unlink(archivo)
        except OSError:
            pass


if __name__ == "__main__":
    main()
