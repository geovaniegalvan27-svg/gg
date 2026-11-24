"""Reads text aloud with a Kokoro TTS server (optional; set "kokoro" in ~/.claude/gg.json).

usage: python3 kokoro.py <server url> <voice id> <speed> <first block>   (blocks as a JSON list on stdin)
       python3 kokoro.py <server url> <voice id> <speed> --texto "<text>"
       python3 kokoro.py <server url> --prender      (wake the server up and leave)

Every block is cut into sentences and made ahead of time: while one sentence plays, the next
ones (of the same block or the next) are already being made, so the reading flows with no pause
between blocks. Prints "BLOQUE <n>" when block n starts playing, so the bar can follow along.
Expects the server's GET /estado and POST /wav {texto, voz, velocidad} -> {archivo}.

The reading never stays silent:
- If the server is off and ~/.claude/gg.json has "kokoroArranque" (a shell command that starts
  it), the command is run and the reading waits for the server (prints "PRENDIENDO" meanwhile).
- A sentence the server cannot make is read with the Mac's own voice (`say`) instead.
"""
import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

ESPERA_S = 90          # the longest a server is waited for after starting it
CANDADO = os.path.join(tempfile.gettempdir(), "gg-kokoro-arranque")
IDIOMAS = {"e": "es", "a": "en", "b": "en", "f": "fr", "i": "it", "p": "pt", "j": "ja", "z": "zh", "h": "hi"}
PALABRAS_POR_MINUTO = 185


def vivo(url):
    try:
        urllib.request.urlopen(url.rstrip("/") + "/estado", timeout=1.5).read()
        return True
    except (OSError, ValueError):
        return False


def arranque():
    try:
        with open(os.path.expanduser("~/.claude/gg.json"), encoding="utf-8") as f:
            orden = json.load(f).get("kokoroArranque")
        return orden if isinstance(orden, str) and orden.strip() else None
    except (OSError, ValueError):
        return None


def prender(url):
    """Starts the server if it is off. True if it is on or on its way."""
    if vivo(url):
        return True
    orden = arranque()
    if orden is None:
        return False
    try:
        if time.time() - os.path.getmtime(CANDADO) < ESPERA_S:
            return True                      # another chat started it a moment ago
    except OSError:
        pass
    with open(CANDADO, "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    subprocess.Popen(orden, shell=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)
    return True


def asegurar(url):
    """Leaves the server answering, starting it if needed. False if there is no way."""
    if vivo(url):
        return True
    if not prender(url):
        return False
    print("PRENDIENDO", flush=True)
    limite = time.time() + ESPERA_S
    while time.time() < limite:
        time.sleep(1)
        if vivo(url):
            return True
    return False


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
        while len(f) > 500:                  # the server takes 600 characters at most
            corte = f.rfind(" ", 0, 500)
            corte = corte if corte > 0 else 500
            if actual:
                partes.append(actual)
                actual = ""
            partes.append(f[:corte])
            f = f[corte:].strip()
        if actual and len(actual) + len(f) > tope:
            partes.append(actual)
            actual = f
        else:
            actual = (actual + " " + f).strip()
    if actual:
        partes.append(actual)
    return partes


def voz_mac(idioma):
    """The Mac's best voice for the language (Premium, Enhanced, then any), or None."""
    try:
        salida = subprocess.run(["/usr/bin/say", "-v", "?"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    voces = []
    for linea in salida.splitlines():
        m = re.match(r"^(.*?)\s+([a-z]{2,3}_[A-Za-z0-9]+)\s+#", linea)
        if m and m.group(2).lower().startswith(idioma):
            voces.append(m.group(1).strip())
    nivel = lambda v: 0 if "premium" in v.lower() else 1 if re.search("enhanced|mejorada", v.lower()) else 2  # noqa: E731
    return sorted(voces, key=nivel)[0] if voces else None


def main():
    if len(sys.argv) >= 3 and sys.argv[2] == "--prender":
        prender(sys.argv[1])
        return
    if len(sys.argv) < 5:
        return
    url, voz, velocidad = sys.argv[1], sys.argv[2], max(0.8, min(1.6, float(sys.argv[3])))
    if sys.argv[4] == "--texto":
        bloques, desde = [" ".join(sys.argv[5:])], 0
    else:
        bloques, desde = json.loads(sys.stdin.read() or "[]"), int(sys.argv[4])
    listos = queue.Queue(maxsize=4)

    def preparar():
        hay = asegurar(url)
        for n in range(desde, len(bloques)):
            for frase in frases(bloques[n]):
                archivo = wav(url, voz, velocidad, frase) if hay else None
                if archivo is None and hay and not vivo(url):      # it went off halfway
                    hay = asegurar(url)
                    archivo = wav(url, voz, velocidad, frase) if hay else None
                listos.put((n, archivo, frase))
        listos.put(None)

    threading.Thread(target=preparar, daemon=True).start()
    actual, de_la_mac = None, False
    while True:
        item = listos.get()
        if item is None:
            break
        n, archivo, frase = item
        if n != actual:
            actual = n
            print(f"BLOQUE {n}", flush=True)
        if archivo is None:
            # No Kokoro for this sentence: the Mac's own voice, so the reading never goes silent.
            if de_la_mac is False:
                de_la_mac = voz_mac(IDIOMAS.get(voz[:1], "es")) or ""
                print("VOZ_MAC", flush=True)
            ritmo = str(round(PALABRAS_POR_MINUTO * float(sys.argv[3])))
            subprocess.run(["/usr/bin/say", *(["-v", de_la_mac] if de_la_mac else []), "-r", ritmo, frase], check=False)
            continue
        subprocess.run(["afplay", archivo], check=False)
        try:
            os.unlink(archivo)
        except OSError:
            pass


if __name__ == "__main__":
    main()
