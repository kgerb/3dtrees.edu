# ForestVerse – Jeder Wald, nur ein Klick entfernt

Project website for ForestVerse (Hochschulwettbewerb 2027, University of Freiburg), served with GitHub Pages at https://kgerb.github.io/3dtrees.edu/.

Plain HTML, CSS and JavaScript. No build step: edit and push.

## Files

- `index.html`: all content. Three tabs (`#project`, `#news`, `#about`). The Projekt tab is only the 3D viewer. New blog posts go at the top of `.posts` in the News tab, one `<article class="post">` each. The earlier Projekt sections (idea, data path, gallery) are in the git history before commit 63c809f.
- `style.css`: layout and colours (light and dark mode).
- `site.js`: tab switching, the DE/EN switch and scroll reveals.
- `forest.js`: the full-screen point-cloud forest on the Project tab (plain WebGL, no libraries). The five forest types and their tree mixes are in `BIOMES`. It shows real 3Dtrees.earth scans from `assets/hero/<key>.bin` when they exist and falls back to a generated illustration otherwise. Make those files with `python tools/make_hero_clouds.py crop.laz black-forest` (writes a dense `.hi.bin` for desktops and a light `.lo.bin` for phones) (keys: black-forest, boreal, congo, borneo, australia; needs `pip install laspy lazrs numpy`). "Mit Cardboard-Brille ansehen" switches to side-by-side stereo and steers with the phone's motion sensors.
- `assets/figure/`: the concept figure, wide and mobile versions per language.
- `assets/examples/`: gallery images (see below).
- `assets/people/`: profile photos (optional).

## Editing text

Every text exists twice, once per language:

```html
<p lang="de">Deutscher Text</p>
<p lang="en">English text</p>
```

Only the active language is shown. Change both when you edit. Text inside the SVG figure uses `data-de` / `data-en` attributes instead.

The language comes from `?lang=de|en`, then the visitor's last choice, then the browser language (German by default).

## Images

Gallery: put files into `assets/examples/` named `<region>-embedding.webp` (square AlphaEarth thumbnail) and `<region>-pointcloud.webp` (point-cloud screenshot), with region `black-forest`, `boreal`, `congo` or `borneo`. Until a file exists, a placeholder pattern is shown.

Photos: put `kilian.jpg`, `marina.jpg`, `teja.jpg` into `assets/people/` and replace the initials in the `.avatar` div with `<img src="assets/people/kilian.jpg" alt="">`.

Concept figure: replace the files in `assets/figure/` (same names).

## Preview locally

```sh
python3 -m http.server
```

Then open http://localhost:8000.

### Editing blog posts in the preview

In the claude.ai preview of this site, each post has an "Beitrag bearbeiten" button (`post-edit.js`). Saving writes the changed text to `post-edits.json` in the preview only, as `{key: {from, html}}`; Claude then copies the new text into `index.html` here. On GitHub Pages the script does nothing.
