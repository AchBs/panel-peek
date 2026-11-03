# Panel Peek 👀

[![Latest release](https://img.shields.io/github/v/release/AchBs/panel-peek?label=download)](https://github.com/AchBs/panel-peek/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/AchBs/panel-peek/total)](https://github.com/AchBs/panel-peek/releases)
![Platform](https://img.shields.io/badge/platform-Windows-blue)

### Oh, you're at work and want to read some manga/manhwa… *secretly*?

Say hi to **Panel Peek**: a tiny see-through reader that floats over your spreadsheets. The moment your mouse leaves it, it disappears into a small, harmless-looking bubble. Your boss walks by and sees nothing. Hover the bubble and you're back on the exact panel you left.

> Reading at work is between you and your conscience. Panel Peek only makes it harder to get caught.

## Why you'll like it

- **Vanishes instantly.** Move the mouse off it and it's gone, with no fade or delay.
- **Boss key.** **Ctrl+Alt+H** hides everything, bubble included. Press it again to bring it back.
- **See-through.** Set the opacity so it blends into whatever is behind it.
- **Remembers your place.** It opens with a **Continue ▸** card that takes you back to the exact chapter and scroll position where you stopped.
- **Reading history, sorted by series.** Each series keeps your latest chapter, and you can jump back into any of them in one click.
- **Your favourite sites, one click away.** Shortcuts for MangaDex, Webtoon, MANGA Plus, Tapas and more. Add any site you like.
- **Blocks ads and popups.** A built-in ad blocker, and popups never open.
- **Reads local folders too.** Point it at a folder of chapter images and it shows them as one long vertical strip, the way manhwa is meant to be read, with next/previous chapter buttons.
- **Always on top, no taskbar button.** Nothing shows up in your taskbar.

## Download

**[⬇ Download PanelPeek-1.0.0.exe](https://github.com/AchBs/panel-peek/releases/download/v1.0.0/PanelPeek-1.0.0.exe)** (Windows 10/11, 64-bit, about 71 MB)

1. Download the exe and double-click it. It's portable, so there's nothing to install.
2. It shows up as a small bubble on the right side of your screen. Hover it to start reading.

All versions are on the [Releases](https://github.com/AchBs/panel-peek/releases) page.

> **"Windows protected your PC"?** The exe isn't code-signed, so SmartScreen warns about it. Click **More info → Run anyway**.

> **Takes a few seconds to open?** That's normal for a portable exe, because it unpacks itself each time it starts.

<details>
<summary>Verify your download (SHA-256)</summary>

```
6f57a5ea87c2be25858891697604863c126c02a399a3437a7c3db1de4af4c652  PanelPeek-1.0.0.exe
```

In PowerShell: `Get-FileHash .\PanelPeek-1.0.0.exe`
</details>

## Controls

| Action | How |
|---|---|
| Open the reader | Hover the bubble for about 0.35 s |
| Hide it | Move the mouse away (instant), press **Esc**, or click **–** |
| Boss key: hide or show everything | **Ctrl+Alt+H** |
| Open or hide from the keyboard | **Ctrl+Alt+M** |
| Move the bubble | Drag it |
| Move the reader | Drag the top bar |
| Resize | Drag either bottom corner |
| Keep it open | 📌 pin |
| Add the current site to Home | ☆ in the Web tab |

## How "Continue" works

Any page whose URL or title looks like a chapter (`/chapter/12`, `chapter-12`, `episode-12`, `ch-3.5`, …) is saved automatically and grouped under its series. Your scroll position is saved every 2 seconds and every time the reader hides. When you click **Continue**, it reopens that page and scrolls back to the same spot as the images load.

Local folders work the same way: the parent folder is the series and each subfolder is a chapter.

## Settings

Everything is stored in `%APPDATA%/Panel Peek/settings.json`:

| Key | What it does |
|---|---|
| `hideDelay` | ms to wait before hiding (0 = instant) |
| `expandDelay` | ms of hovering before it opens |
| `opacity` / `bubbleOpacity` | how see-through the reader and the bubble are |
| `adblock` | `false` turns the ad blocker off |
| `sites` | your Home screen shortcuts |

## Build it yourself

You need [Node.js](https://nodejs.org) LTS.

```bash
npm install
npm start          # run it
npm run dist       # build dist/PanelPeek-<version>.exe
```

To build the Windows exe on Linux, the config sets `signAndEditExecutable: false`, so you don't need Wine.

## Built with

Electron, plus [@ghostery/adblocker-electron](https://github.com/ghostery/adblocker) for ad blocking.

## Disclaimer

Panel Peek is a general-purpose reader. It is basically a tiny browser and does not host, download or distribute any content. Please support the official releases and creators when you can, and follow your workplace's rules. 😉
