"""Reads text aloud with a Kokoro TTS server (optional; set "kokoro" in ~/.claude/gg.json).

usage: python3 kokoro.py <server url> <voice id> <speed> <first block>   (blocks as a JSON list on stdin)
       python3 kokoro.py <server url> <voice id> <speed> --texto "<text>"

Every block is cut into sentences and made ahead of time: while one sentence plays, the next
ones (of the same block or the next) are already being made, so the reading flows with no pause
between blocks. Prints "BLOQUE <n>" when block n starts playing, so the bar can follow along.
Expects the server's POST /wav {texto, voz, velocidad} -> {archivo}.
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
    url, voz, velocidad = sys.argv[1], sys.argv[2], max(0.8, min(1.6, float(sys.argv[3])))
    if sys.argv[4] == "--texto":
        bloques, desde = [" ".join(sys.argv[5:])], 0
    else:
        bloques, desde = json.loads(sys.stdin.read() or "[]"), int(sys.argv[4])
    listos = queue.Queue(maxsize=4)

    def preparar():
        for n in range(desde, len(bloques)):
            for frase in frases(bloques[n]):
                archivo = wav(url, voz, velocidad, frase)
                if archivo:
                    listos.put((n, archivo))
        listos.put(None)

    threading.Thread(target=preparar, daemon=True).start()
    actual = None
    while True:
        item = listos.get()
        if item is None:
            break
        n, archivo = item
        if n != actual:
            actual = n
            print(f"BLOQUE {n}", flush=True)
        subprocess.run(["afplay", archivo], check=False)
        try:
            os.unlink(archivo)
        except OSError:
            pass


if __name__ == "__main__":
    main()
