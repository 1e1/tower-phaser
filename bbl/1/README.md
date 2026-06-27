# Brown bag — « Coder avec une IA agentique »

Support de présentation pour un brown bag lunch (~22 min Lightning à ~40 min Deep dive + Q&A) destiné à des développeurs pros, racontant la construction de **Tower Duel** comme fil rouge d'une méthode de dev assisté par IA.

## Contenu
- **`index.html`** — le support visuel **en anglais** (impress.js), **44 steps** (31 en Lightning), **thème repris du jeu/doc : un biome par chapitre**. Six chapitres-biomes : 🌱 Meadow (intro : écran TV → lobby → spark → démo) · 🏜️ Desert (le brief réel + les 4 lots) · ❄️ Tundra (momentum + boîte à outils) · 🌋 Volcano (principes + posture) · ⛈️ Storm (machinerie + cicatrices) · 🌅 Meadow-aube (clôture). En entrant dans un chapitre, le **ciel global bascule sur le biome** ; les cartes sont des « sheets » lisibles à l'accent du biome. Cartes-prompts concrètes (le vrai brief, fork, simulateur, feedback, glossaire) + slide chiffres (stats Git réelles) + QR auto.
- **`script-conference.md`** — **ce que je dis, slide par slide** (prompt oral FR aligné sur l'ordre réel des 44 slides) : à dérouler en présentant.
- **`trame-orale.md`** — note de prépa de l'orateur **en français** (→ DeepL pour l'EN) : deux parcours (⚡ Lightning ~22 min / 🔬 Deep dive ~40 min), cues de démo, checklist, Q&A, sources. *(Le déroulé slide-par-slide y est en numérotation héritée décalée → réfère-toi à `script-conference.md`.)*
- **`lib/impress.js`** — impress.js v2, embarqué (hors-ligne).
- **`lib/fonts.css` + `lib/fonts/`** — Fredoka / Nunito / JetBrains Mono (les polices de la doc), embarquées en local pour rester hors-ligne.
- **`lib/qrcode.js`** — générateur de QR hors-ligne.

> **Sources de l'acte « principes / machinerie »** : talk de Daisy Hollman « Beyond the basics with Claude Code » + l'article de synthèse de l'auteur. Crédit affiché sur la slide « Accelerators ».
> **Source des chiffres « code ≠ valeur »** : Demirer, Musolff & Yang, *Writing Code vs. Shipping Code*, **NBER WP 35275** (mai 2026, DOI 10.3386/w35275) — https://www.nber.org/papers/w35275. Chiffres alignés sur le résumé : commits **+40/+140/+180 %** (autocomplétion/synchrone/asynchrone) → **+50 %** projets → **+30 %** releases ; **σ≈0,25**. Citée sur la slide + dans les notes orales.

## Présenter
1. Ouvrir `index.html` dans un navigateur récent (Chrome/Firefox/Safari).
2. `F11` pour le plein écran.
3. **Choisir la durée sur la slide titre** via le switch *simulateur* : **⚡ Lightning · 22 min** ↔ **🔬 Deep dive · 40 min** (défaut). Lightning masque en direct **13 slides** (5 `deep` : feedback, fenêtre+cache, briques, accélérateurs, value aval ; 8 `trim` : les 4 lots détaillés, itération, Technique 1, constellation, garder le cap) — la navigation les saute, sans recharger la page ; le choix est mémorisé.
4. Navigation : **Espace** ou **→** avancer · **←** reculer · taper un numéro puis revenir au début avec **0**.
5. Suivre `trame-orale.md` en parallèle (sur un 2e écran / téléphone).

> Côté technique : le switch s'appuie sur le plugin `skip` d'impress.js (la classe `skip` est évaluée dynamiquement à chaque navigation), donc la bascule est instantanée et sans réinitialisation. Les slides masquées en Lightning portent la classe `deep` (référence/principe) ou `trim` (détail redondant) dans le HTML ; le toggle ajoute `skip` à `.deep, .trim` en mode Lightning.

## Éditer
- Le contenu des slides est dans `index.html` (`<div class="step">…`).
- **Disposition = side-scroller horizontal de mondes-biomes.** Le script (`CHAPTERS=[{biome,n}…]`, `layout()`) place les slides de gauche à droite (`data-x = gi*SX`), groupées par chapitre, taguées par biome. Intra-chapitre : panoramique horizontal. Entre chapitres : léger virage 3D (`rotateY`) + bascule du ciel (biome). Ouverture = plan large (zoom), martèlement = punch. Le dézoom (`.overview`) montre le ruban de tous les slides. Les slides `class="fixed"` (dézoom + finale) gardent leurs coords manuelles. *(NB : un essai « roulé de dé » intra-chapitre a été tenté puis abandonné — trop brouillon.)*
- **Biomes** : définis en haut du `<style>` via `[data-biome="meadow|desert|tundra|volcano|storm"]` (palettes du jeu). Le fond global + le **soleil/lune parallax** suivent le biome de la slide visée, déclenchés sur `impress:stepleave` (début de transition → mouvement simultané à la caméra, `1s ease-in-out`). Le ciel fait un vrai fondu via `@property` (couleurs animables).
- **Soleil = jauge de progression** : arc lever→coucher au fil des slides (sans numéro). Le **numéro de step** (séquentiel, `i+1`) est gravé en **relief** dans le coin bas-droite de chaque carte (`.stepnum`), avec une légère contraste vs le fond (plus foncé sur clair, plus clair sur sombre via `.tv .stepnum`). Overview exclu (pas de surface).
- **Grain de papier** : texture `feTurbulence` en `background-image` des cartes claires (`.step`) ; auto-désactivée sur `.tv`/`.overview` (leur `background` shorthand réinitialise l'image).
- **Montagnes parallax + profondeur** : 2 calques (`#mtn-far`/`#mtn-near`, silhouette lisse via masque SVG en courbes, couleur `--mtn1/--mtn2` du biome). Sur `stepleave` : dérive horizontale (`--mpx`, loin lent / près rapide) + `transform` synchro avec la 3D des slides — `rotateY` du chapitre (réduit par calque) + dolly de profondeur calé sur le zoom (couverture = reculé, détail = avancé). Silhouette seule, sans sol/crête. Les 2 slides fixes ont leur propre plan : « all this » envoie les montagnes loin (scale ~0.5), « thanks » les amène tout près (scale ~1.85).
- **Format keynote** : chaque chapitre du cœur est encadré par une **ouverture** (`.opener`, plein-cadre, preview) et un **martèlement** (`.hammer`, plein-cadre, 1 phrase). Animation : opener `data-scale 1.5` (dézoom large), hammer `0.82` (zoom-avant/punch) — posés dans `layout()`. Texte ink sur biomes clairs, blanc sur volcano/storm. Pas de numéro de step sur ces slides.
- **Screenshots d'artefacts** : dans `img/` (capturés des labs). **Cliquables** → ouvrent la page live (GitHub Pages : `…/assets/ost-lab.html`, `…/assets/pathfinding-lab.html`, `…/fr/` ; battlefield-lab → **htmlpreview.github.io** qui *rend* `design/battlefield-lab.html` (autonome, non publié sur Pages — d'où htmlpreview plutôt qu'une URL `…/assets/`)). Le simulateur (tech 3, classe `.hasflip`) est une **carte flip** prompt→screenshot, **pilotée par la touche *next*** : un hook `keyup` en capture sur `window` (impress agit sur keyup) intercepte le 1er *next* pour retourner la carte (`.flipped`, transition 0,9 s) sans avancer ; le 2e *next* avance ; *prev* dé-retourne ; reset à l'entrée. Slide « artefact constellation » = galerie de 3 screenshots cliquables.
- **Brief annoté** (slide 6) : `.anat` dissèque le prompt fondateur en parties étiquetées (reference / intent / batches / naming / rules).
- **Slide finale** invisible (`opacity:0`) sauf quand on est dessus (révélation en fondu).
- **Cartes uniformes** : toutes les cartes de chapitre ont la même taille (`width:1040px` + `min-height:586px`, contenu centré) via `.step:not(.opener):not(.hammer):not(.overview):not(.finale)`. Les plein-cadre + la finale sont exclues.
- **Montagnes** : calques très larges (`left/right:-25%`) pour déborder le cadre à tout ratio.
- **Thème** : identité jeu/doc — Fredoka (titres), Nunito (corps), JetBrains Mono (prompts), cartes « sheet » crème, accent par biome. Pas de blur/filtre (perf).
- **QR codes** : règle automatique — toute slide avec `<div class="qr" data-qr="URL" data-qr-cap="...">` reçoit un QR hors-ligne (`lib/qrcode.js`). Présents sur la démo et la finale.

> Astuce : pour partager une version en ligne avec les collègues, on peut inliner `lib/impress.js` dans le HTML et publier en artefact. Demande-le si besoin.
