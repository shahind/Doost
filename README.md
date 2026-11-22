<div align="center">
  <img src="www/icons/icon-192.png" width="96" alt="Doost logo" />
  <h1>دوست · Doost</h1>
  <p><b>گنجینهٔ همراه شعر پارسی، سریع، سبک و کاملاً آفلاین</b><br/>
  A pocket library of Persian poetry: fast, lightweight and fully offline.</p>

  <p>
  <a href="https://shahind.github.io/Doost/"><img alt="Web" src="https://custom-icon-badges.demolab.com/badge/Web-35646A?logo=globe&logoColor=white&style=for-the-badge" width="104"></a>
  <a href="https://github.com/shahind/Doost/releases/latest"><img alt="Windows" src="https://custom-icon-badges.demolab.com/badge/Windows-0078D6?logo=windows11&logoColor=white&style=for-the-badge" width="161"></a>
  <a href="https://github.com/shahind/Doost/releases/latest"><img alt="Linux" src="https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black&style=for-the-badge" width="123"></a>
  <a href="https://github.com/shahind/Doost/releases/latest"><img alt="iOS" src="https://img.shields.io/badge/iOS-000000?logo=apple&logoColor=white&style=for-the-badge" width="99"></a>
  <a href="https://github.com/shahind/Doost/releases/latest"><img alt="Google Play" src="https://img.shields.io/badge/Google_Play-414141?logo=googleplay&logoColor=white&style=for-the-badge" width="194"></a>
  <a href="https://cafebazaar.ir/app/com.shahinsoft.doost"><img alt="Bazaar" src="https://img.shields.io/badge/Bazaar-2BAE66?logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCc+PHBhdGggZD0nTTQuNSA4aDE1bC0xLjIgMTIuNUg1Ljd6JyBmaWxsPSd3aGl0ZScvPjxwYXRoIGQ9J004LjUgOFY2LjhhMy41IDMuNSAwIDAgMSA3IDBWOCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyJy8+PC9zdmc+&logoColor=white&style=for-the-badge" width="139"></a>
  </p>

  <img src="docs/screenshots/desktop.png" alt="Doost on desktop" width="820" />
  <br/><br/>
  <img src="docs/screenshots/mobile-home.png" alt="Home" width="200" />&nbsp;
  <img src="docs/screenshots/mobile-poem.png" alt="A poem" width="200" />&nbsp;
  <img src="docs/screenshots/mobile-faal.png" alt="Faal-e Hafez" width="200" />
</div>

## Download

| Platform | |
|---|---|
| Web | [shahind.github.io/Doost](https://shahind.github.io/Doost/), installable, works offline |
| Android | [Cafe Bazaar](https://cafebazaar.ir/app/com.shahinsoft.doost) or the `.apk` from [Releases](https://github.com/shahind/Doost/releases/latest) |
| iOS | unsigned `.ipa` from [Releases](https://github.com/shahind/Doost/releases/latest) (install with AltStore or Sideloadly) |
| Windows | installer or portable `.exe` from [Releases](https://github.com/shahind/Doost/releases/latest) |
| Linux | `.AppImage` or `.deb` from [Releases](https://github.com/shahind/Doost/releases/latest) |

## Features

- **237 poets and 133,000 poems** (3 million verses), from Hafez, Saadi, Rumi and Ferdowsi to modern poets.
- **Search everything**: poet names, poem titles and the text of every verse. Half-spaces and diacritics don't matter. Search all poets, one poet or one book.
- Poems in the traditional **couplet layout**.
- **Faal-e Hafez**: form your intention, open the Divan and read the ghazal with its interpretation.
- **Tap a word** to look up its meaning in the [Yaad](https://github.com/shahind/Yaad) dictionary.
- **Bookmarks**, continue reading where you left off, and sharing a verse or a poem as text or image.
- Light and dark themes, adjustable text size.
- **No internet needed**, no ads, no data collected.

---

## For developers

### Why it is fast and light

- The 341 MB SQLite database is packed into **63 MB** of compressed data, and the app no longer loads a whole database into memory.
- At startup the app reads only a **1 MB catalog**, in 100–250 ms. Verses are stored in small blocks and loaded only when needed. Persian text is re-encoded to one byte per letter before compression.
- Poems are stored in reading order, so the next poem is usually already loaded and "search in this poet" is just a range.
- Verse search uses a prefix-sharded word index in a Web Worker: **15–120 ms** per page of results, without blocking the screen.
- The fonts are subset WOFF2 files: 325 KB instead of 1.1 MB.

### Technology

Plain **JavaScript, HTML and CSS**, with no framework and no bundler. **Capacitor** wraps it for Android and iOS, and **Electron** for Windows and Linux. The data is built with **Node.js** scripts in `tools/`.

### Run, test, build

Needs Node.js 22+ and [Git LFS](https://git-lfs.com) (the source database is stored with it).

```bash
git lfs pull
npm install
npm run build:data   # build the poetry data into www/data
npm test             # search tests
npm run serve        # open http://localhost:5173
```

| Target | Command |
|---|---|
| Desktop app | `npm run electron` |
| Windows build | `npm run dist:win` |
| Linux build | `npm run dist:linux` |
| Android | `npm run android` (opens Android Studio) |
| iOS | `npm run ios` (opens Xcode, macOS only) |

## Credits

- Poetry: Ganjoor (گنجور), from [ganjoor/desktop](https://github.com/ganjoor/desktop) and [ganjoor/ganjoor-data](https://github.com/ganjoor/ganjoor-data).
- Fonts: Amiri and Estedad (SIL Open Font License).
- Code: [GNU GPL v3](LICENSE).
