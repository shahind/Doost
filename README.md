<div align="center">
  <img src="www/icons/icon-192.png" width="96" alt="Doost logo" />
  <h1>دوست · Doost</h1>
  <p><b>گنجینهٔ همراه شعر پارسی — سریع، سبک و کاملاً آفلاین</b><br/>
  A fast, lightweight, fully offline Persian poetry library (Ganjoor) for Web, Android, iOS, Windows and Linux.</p>
  <p><a href="https://shahind.github.io/Doost/"><b>▶ Open the web version</b></a></p>

[![Android](https://img.shields.io/badge/Android-3DDC84?logo=android&logoColor=white)](https://github.com/shahind/Doost/releases)
[![iOS](https://img.shields.io/badge/iOS-000000?&logo=apple&logoColor=white)](https://github.com/shahind/Doost/releases)
[![Windows](https://custom-icon-badges.demolab.com/badge/Windows-0078D6?logo=windows11&logoColor=white)](https://github.com/shahind/Doost/releases)
[![Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)](https://github.com/shahind/Doost/releases)
</div>

---

## Features

- **237 poets, 2,246 books & sections, 133,159 poems, 3 million verses** — browse poet → book →
  section → poem, with breadcrumbs, previous / next poem (buttons, swipe, ← → keys).
- **Instant search** in poet names, book / section titles, poem titles and **the text of every verse**.
  Diacritics, ZWNJ / spaces, and Arabic letter forms (ي ك ة …) don't matter. Matches are word-start
  aware («دل» finds «دل» and «دلبر», not «بیدل»). Results stream page by page, famous poets first.
- **Scoped search**: all poets, one poet, or any book / section of a poet.
- Classic couplet layout: side-by-side half-lines on wide screens, staggered on phones;
  centered tarji'/tarkib bands, free verse and prose rendered appropriately.
- **Favorites** (grouped by poet), featured poets, recent searches, **continue reading** where you left off.
- Share / copy a whole poem **or a single beyt** (tap a verse).
- Poet biographies, random poem (everywhere, per poet, per section).
- Light / dark / automatic theme, adjustable poem text size.
- **100% offline**. The web version caches what you read (or everything, from Settings).

Existing users keep their favorites, featured poets and theme: the same storage keys are used,
and the desktop app keeps the same origin and profile folder.

## Performance

| | Before (sql.js) | Now |
|---|---|---|
| Shipped data | 341 MB SQLite file loaded fully into WASM memory | **≈ 63 MB**, loaded on demand |
| Startup | download / parse 341 MB | ≈ 100–250 ms (1 MB catalog) |
| Verse search | `LIKE '%…%'` on the UI thread, 50 results, no normalization | 15–120 ms per page in a Web Worker, unlimited, normalized |
| Fonts | 1.1 MB TTF | 325 KB WOFF2 (subset) |

## How it works

[`tools/build-data.mjs`](tools/build-data.mjs) converts `db/ganjoor.s3db` (Git LFS) into `www/data/`:

| File | Content |
|---|---|
| `catalog.txt` | poets, the section tree and all poem titles (1 MB gzip) — loaded at startup |
| `poems.txt`, `bios.txt` | Ganjoor poem ids & section of each poem; poet biographies (lazy) |
| `v/<n>.txt` | verse text in ~64 KB blocks, transcoded to a single-byte charset before gzip |
| `t/<n>.txt` | inverted index word → poems, sharded by word prefix (supports prefix search) |

Poems are stored in **reading order**: poets by Ganjoor id (≈ prominence), then each poet's book
tree. So the next poem is usually in an already-loaded block, "search within this poet / book"
is just a range, and results naturally list Hafez, Khayyam, Ferdowsi, Molana… first.
A query intersects the posting lists of its words (the last word as a prefix), then verifies the
exact phrase in the candidate poems' verses.

## Project layout

```
db/ganjoor.s3db     source database (Git LFS)
tools/              data builder, search smoke test, dev server, Pages deploy
www/                the app (vanilla JS, no framework, no bundler)
  js/app.js           UI          js/worker.js   data & search engine (Web Worker)
  data/               generated (git-ignored): npm run build:data
electron/main.cjs   desktop shell (Windows / Linux)
android/, ios/      Capacitor native projects
assets/             icon & splash sources
```

## Build

Requires Node.js 22+ and `git lfs pull` (for the database).

```bash
npm install
npm run build:data      # db/ganjoor.s3db -> www/data (~2.5 minutes)
npm test                # search smoke tests
npm run serve           # http://localhost:5173
```

- **Desktop:** `npm run electron` · `npm run dist:win` · `npm run dist:linux`
- **Android:** `npx cap sync android`, then `cd android && ./gradlew assembleDebug` (or `npm run android`)
- **iOS:** `npm run ios` on macOS; CI builds an unsigned IPA ([`ios-build.yml`](.github/workflows/ios-build.yml))
- **Web:** `npm run build:data && bash tools/deploy-pages.sh` publishes `www/` to `gh-pages`

## Credits

- Poetry database: [Ganjoor](https://ganjoor.net) (گنجور).
- Fonts: Amiri and Estedad — SIL Open Font License.
