# ☁️ GG

A little cloud that lives above the prompt of the **Claude desktop app** (Code tab, macOS).
It keeps your open chats one click away, tells you when one finishes, and reads Claude's
answers aloud with the voices already on your Mac — no internet, no API keys, no tokens.

*Una nubecita que vive arriba del renglón de Claude: tus chats abiertos a un clic, un aviso
suave cuando uno termina, un puntito rojo cuando uno te necesita, y lectura en voz alta con las
voces de la Mac. Sin internet ni tokens.*

```
 (••)  🔊  1x 🗣 🔔   • 🧩 Mods ⧉   • 🌐 Web   • 🐞 Bug   (📈 Trading)   📄
  │     │   │   │    │             │          │           └ finished while you were away: soft green pill blinks
  │     │   │   │    │             │          └ needs your answer or approval: the dot blinks red
  │     │   │   │    │             └ working: the green dot blinks
  │     │   │   │    └ the chat you are in (⧉ pops it out into its own window)
  │     │   │   └ chime on/off — the bell swings when a chat finishes
  │     │   └ reading speed: 1x · 1.5x · 2x, and 🗣 to pick the voice
  │     └ read aloud — becomes ⏮ 2/7 ⏭ ⏹ while reading
  └ the cloud breathes; gray idle · violet others working · blue a chat finished · orange reading
```

## What it does

- **Tabs for your open chats.** Each chat gets a topic emoji and a short name from its title.
  Click one and the window switches to it, without reloading anything. Chats in use come first
  with their names; idle ones shrink to just their emoji at the end.
- **Know when a chat needs you.** When Claude stops to ask you something or wait for an approval,
  that chat's dot blinks red, so you know where to go.
- **Know when a chat is done.** A chat that finished while you were looking elsewhere blinks as a
  soft green pill, a gentle chime plays once, and the bell swings for a moment.
- **Read aloud, block by block.** 🔊 reads everything Claude wrote since your last message, from
  the top, one text block after another, outlining the block being read in the chat.
  ⏮ ⏭ jump between blocks (repeat the previous one, skip ahead), ⏹ stops, and the speed button
  cycles 1x · 1.5x · 2x. `/leer` does the same from the prompt.
- **Free and local.** Voices come from macOS's built-in speech; the "a chat finished" signal is
  the short summary the app already writes for each chat. Nothing is sent anywhere.

## Install

In the Claude app (or `claude` in a terminal):

```
/plugin marketplace add geovaniegalvan27-svg/gg
/plugin install gg@gg
```

Then start a new chat (or restart the open ones). `/gg` shows or hides the bar.

Requires macOS and the Claude desktop app's Code tab.

## Nicer voices (free)

Press 🗣 to pick any installed voice for your language (you hear a short sample and it is
remembered). By default GG picks the best one: **Premium**, then **Enhanced**, then any. The voices macOS ships by default sound robotic; the good ones are a free download:

**System Settings → Accessibility → Spoken Content → System voice → Manage Voices…**, pick your
language and download a voice marked *Premium* or *Enhanced* (for Spanish, for example
*Paulina*, *Mónica* or *Marisol*). GG uses it on the next chat.

## Settings (optional)

Create `~/.claude/gg.json`:

```json
{
  "idioma": "es",
  "voz": "Paulina (Premium)",
  "temas": [
    { "buscar": "invoice|factura", "emoji": "🧾", "nombre": "Facturas" },
    { "buscar": "\\bblog\\b", "emoji": "✍️", "nombre": "Blog" }
  ]
}
```

- `idioma`: language code used to pick a voice (`es`, `en`, `pt`…). Default `es`.
- `voz`: an exact voice name from `say -v '?'`, to skip the automatic pick.
- `kokoro`: URL of a local [Kokoro](https://github.com/hexgrad/kokoro) TTS server with a `POST /wav`
  endpoint; when it answers, its natural Spanish voices show up first in 🗣.
- `temas`: your own topics, checked before the built-in ones. `buscar` is a regular expression
  matched against the chat title.

A title written as `Topic · what it is` uses the part before `·` as the tab name.

## How it works

GG is a Claude Code mod (a hooks module). It reads the desktop app's own session list
under `~/Library/Application Support/Claude/` to know which chats are open, working, finished or waiting for you,
switches chats with the app's `claude://code/continue?session=…` link, and reads aloud with
`/usr/bin/say`. It writes nothing outside its own state.

## License

MIT
