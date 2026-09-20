# Fonts (self-hosted Inter)

The app ships **Inter 18pt**, subset to the Latin ranges and converted to
`woff2`. These six files are the only ones the design needs — total ≈ 194 KB:

| File | Weight | Used for |
| --- | --- | --- |
| `Inter-Regular.woff2` | 400 | body text |
| `Inter-Italic.woff2` | 400 italic | incidental italics in copy |
| `Inter-Medium.woff2` | 500 | labels, navigation |
| `Inter-SemiBold.woff2` | 600 | buttons, table headers |
| `Inter-Bold.woff2` | 700 | card titles |
| `Inter-ExtraBold.woff2` | 800 | headings / hero |

They are declared in `src/app/globals.css` with `font-display: swap` and a
system fallback chain, so text renders immediately and degrades gracefully if a
file is ever missing.

## Replacing the fonts (e.g. a new Inter release)

1. Drop the new static TTFs into this folder (`Inter_18pt-Regular.ttf`,
   `Inter_18pt-Italic.ttf`, `Inter_18pt-Medium.ttf`, `Inter_18pt-SemiBold.ttf`,
   `Inter_18pt-Bold.ttf`, `Inter_18pt-ExtraBold.ttf`).
2. Run the converter — it subsets to Latin, writes the `.woff2` files above and
   deletes every `.ttf`:

   ```powershell
   python -m pip install fonttools brotli   # once
   python scripts/subset-fonts.py
   ```

3. Commit the resulting `.woff2` files.

Why only the 18pt optical size: Inter 4.x ships 18/24/28pt cuts. 18pt matches
13–18px UI text; the 24pt/28pt files are display cuts this design does not use,
and dropping them removed ~17.5 MB from the repository.

## Notes

- Fonts are served from the app's own origin, matching the CSP
  `font-src 'self' data:` in `next.config.ts` — no external font CDN.
- Do **not** re-introduce `next/font/google`: it downloads fonts at build time,
  which breaks offline/locked-down CI builds (and Turbopack rejects wrapping the
  loader in try/catch).
