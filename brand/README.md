# EntryLink brand assets

Original logo and favicon files. `generate_assets.py` recreates the PNG/ICO files from the same
geometry as the SVGs (needs Pillow: `pip install pillow`).

| File | What it is |
|---|---|
| `entrylink-logo-light.svg` / `.png` | Wordmark for light backgrounds |
| `entrylink-logo-dark.svg` / `.png` | Wordmark for dark backgrounds |
| `entrylink-favicon-{light,dark}.svg` | Square mark (browser tabs, app icons) |
| `entrylink-favicon-{light,dark}-{16,32,180,512}.png`, `.ico` | Raster favicons |
| `entrylink-preview.png` | Overview of all variants |
| `entrylink-brand-assets.zip` | Everything above in one download |

**Colours:** mark purple `#8C8EE7`, light-mode accent `#6669C9`, dark-mode accent `#A5A7FF`,
dark background `#181A22`, light background `#F7F7FC`.

## Where the app uses them

- **Web** (`apps/web/public/`): `logo-{light,dark}.svg`, `favicon-{light,dark}.svg`, `favicon.ico`,
  `apple-touch-icon.png` (180), `icon-512.png`. They're copies, so update both places if the logo changes.
- **Mobile** (`apps/mobile/assets/`): app icon, Android adaptive layers, splash and `brand-mark.png`
  are rendered from the same geometry (full-bleed or transparent, at the sizes iOS/Android need).
- **UI colours:** buttons and links use `#5c5fc4` in light mode (one shade deeper than `#6669C9`, so
  text meets WCAG AA 4.5:1 on tinted backgrounds) and `#A5A7FF` in dark mode.
