# Faboolux Accessories Extractor

Serverless web app (GitHub Pages). Upload an estimate `.xlsx` and get the accessories list per room, with specification, quantity and image from the database. Nothing is uploaded or saved; the Google Sheet is only read.

- **Database:** the `masterdata` tab (A item, B specification, C image link), read live with a read-only Google API key and re-checked every minute (and on focus). Edit the sheet and the page updates itself.
- **Items not in the database** are highlighted in red (item name only) with a "Not found in database" note and a banner.
- **+ Add Manual Item** per room (with image attach), **Print PDF** downloads a clean A4 landscape PDF directly.
- Same extraction rules as the original Apps Script (verified identical on 1,500 random estimates).

## Setup
1. Settings → Pages → Deploy from branch `main`, root.
2. `settings.js` holds `SHEET_ID` and `API_KEY`. The key must allow the Google Sheets API and the website referrer `https://fabooluxinterior.github.io/*`.
3. The database sheet must be shared "Anyone with the link: Viewer".
