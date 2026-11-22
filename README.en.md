# Web Video Subtitle Extension

[한국어](README.md) | **English**

A cross-browser Manifest V3 extension that adds **external subtitle lookup, progressive AI translation, and dual-subtitle overlay** to web video sites when your preferred subtitle language is unavailable.

> Only text-based subtitle files are processed. Video and audio streams are never downloaded or transcribed.

---

## Key Features

- **Automatic Subtitle Pipeline**: Detects the active title and episode, prioritizes external subtitles first, and falls back to AI translation only when needed.
- **Progressive AI Translation**: Translates the first chunk quickly so playback starts right away while continuing in the background (prioritizing the current timestamp on seek).
- **Dual Subtitles**: Optionally displays original Japanese subtitles underneath Korean subtitles with independent font size and timing offset controls.
- **Sync Controls & Shortcuts**: Per-episode offset persistence and keyboard shortcuts right on the player.
- **Local & Cloud Translation Engines**: Supports both Local LLM (LM Studio / OpenAI-compatible endpoints, including LAN servers) and Gemini API.

---

## Installation

Download a build archive from [Releases](https://github.com/puruuun/web-video-subtitle-extension/releases):

| Build Profile | Archive | Permission Scope | Best For |
| :--- | :--- | :--- | :--- |
| **Personal (Recommended)** | `anime-korean-subtitle-v0.5.5.zip` | `<all_urls>` | Zero runtime permission prompts across subtitle hosts and local LLMs |
| **Public** | `anime-korean-subtitle-public-v0.5.5.zip` | Declared hosts + optional opt-in | Least-privilege setup with explicit per-host approval |

1. Extract the ZIP archive and locate the `extension/manifest.json` folder.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Set **Site access → On all sites** in extension details, and configure your translation engine in Settings if needed.

---

## Auto Pipeline

```text
External Korean subtitles (Anissia → Web Korean fallback search)
        ↓ Not listed or episode file unavailable
External Japanese subtitles (Jimaku → Kitsunekko mirror) → Progressive AI translation
        ↓ No usable file found
Embedded player English subtitles → Progressive AI translation
```

- When a Korean subtitle is found, no AI translation API is called.
- Manual mode lets you run Korean search, Japanese search + translation, or embedded English translation individually.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + [` | Subtitle sync `-0.5s` |
| `Alt + ]` | Subtitle sync `+0.5s` |
| `Alt + \` | Reset subtitle sync (`0.0s`) |
| `Alt + J` | Toggle dual Japanese subtitles |

---

## Support & Roadmap

- **Browsers**: Chrome / Edge / Brave (Desktop), Firefox (Desktop & Android), Safari (macOS & iOS Web Extension)
- **Currently Supported Sites**: Miruro and Re:ANIME (including `flixcloud.cc` / `strm.cx` embedded players) with Korean & dual Japanese subtitles
- **Planned Expansion**: Broader web video site adapters and customizable target translation languages

---

## Security & Privacy

- All external API calls run inside the background service worker; API keys and tokens are isolated in `TRUSTED_CONTEXTS` extension storage.
- Credentials are never exposed to content scripts, page DOM, or browser consoles.
- Only text subtitles (`.srt`, `.ass`, `.ssa`, `.smi`, `.vtt`, WebVTT HLS) and subtitle ZIP archives are processed.

---

## Development & Build

Node.js 22+ is recommended.

```bash
npm ci
npm run check                  # typecheck + unit tests + build
npm run build:personal         # Chrome personal build (dist/)
npm run build:public           # Chrome public build (dist/)
npm run build:firefox:personal # Firefox (Desktop & Android) personal build
npm run build:safari:personal  # Safari (macOS & iOS) personal build
```

Firefox `.xpi` bundles and unsigned iOS Safari `.ipa` packages can be built via the GitHub Actions workflow **Build Mobile Packages (Firefox & iOS Safari)**.

See [DEVELOPMENT.md](DEVELOPMENT.md) for verification notes and technical details.
