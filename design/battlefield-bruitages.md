# Champ de bataille vivant — Bruitages 2.0.0 (livré)

> **Statut** : checklist de design audio (cible **2.0.0**). Vit dans `./design/` ; à migrer dans une **annexe audio** de `docs-src/` à l'implémentation (l'annexe n'existe pas encore — seul `ost-lab.html` est publié).
> **Compagnon** : `design/battlefield-sfx-lab.html` — proto/tuning Web Audio de chaque son ci-dessous, dans la lignée d'`ost-lab.html`.
> **Convention** : tout nouvel émetteur respecte la spatialisation (`depth → tilt → pan`) et est capté par le **bon micro** — soldats par la **tour** la plus proche (P1/P2), épée/arc/cri de l'Intendant par son **micro mobile** (P3). Cf. mémoire `audio-spatialization-convention`.
> **Implémentation (réalité)** : le mode 3ᵉ joueur est **livré** (commit v2.0.0 `60fa0c4` — `sim/battlefield.js`, `BattlefieldView.js`, `IntendantScene.js`, bouclier magique). Un **canal d'évènements** existe déjà (`EVENT_TYPES` dans `snapshotCodec.js`) et **pilote déjà** les SFX du duel (`fire/impact/hit/destroyed/shieldHit` dans `TvScene.js` + `ControllerScene.js`). Brancher l'audio battlefield = **ajouter des types d'évènements** + leurs handlers au même endroit + porter les timbres du lab. Restent 2 infra à bâtir : **spatialisation** (`depth/tilt/pan` + micro mobile P3) et **bus réverb** (pour les sons modernes).

---

## 1. Ce qui existe (réutilisable) — `src/systems/Sfx.js`

Le moteur ne couvre aujourd'hui que le **duel d'artillerie 1v1**. Tout est synthétisé (Web Audio, aucun asset binaire).

| Fonction | Sert à | Réutilisable pour 2.0.0 |
|---|---|---|
| `boom()` | tir du gros canon | **Canon de campagne** (tir, variante) |
| `whistles(list)` | **sifflement par projectile en vol** (polyphonique, indexé par id) | **Toute** la phase « passage du projectile » (balle, flèche, grenade, boulet) |
| `explosion(vol)` | impact d'obus (atténué par distance) | **Grenade** (burst), **boulet** (impact sol) |
| `hit()` | coup direct sur tour (anneau métallique) | impact **boulet sur tour** |
| `rubble(big)` | tour touchée / effondrement (pierre) | tour / ruine — **pas** pour le bois |
| `shieldUp()` / `shieldBlock()` | bouclier | inchangé |
| `thunder()`, vent, musique | ambiance | inchangé |

**Grand manque de timbre** : le moteur n'a que du **minéral / métal / explosif**. Toute la couche **chair** (impacts sur corps, grognements, cri) et **bois** (canon de campagne détruit) est à créer.

---

## 2. Le manque, acteur par acteur

> ✅ **Tout le §2 est désormais livré et câblé** (events `sim/battlefield.js` → `Sfx.playEvent` → timbres). La colonne « Conception » garde l'intention d'origine ; « Livré » donne le branchement réel. Détail du dispatcher : §5.

`Conception` = intention initiale (`NEW`=à composer / `REUSE`=dérivé) · `Livré` = event → timbre effectif.

### Intendant
| Événement | Conception | Livré (event → timbre) |
|---|---|---|
| Tir d'arc — lâcher de corde | *twang* | ✅ `intBow` → `bowTwang` (micro P3) |
| Flèche en vol | `whistles` léger | ✅ `whistles` (freq `fromI` 1500, micro mobile) |
| Flèche — impact sol | *thunk* boisé | ✅ `projGround` k1 → `arrowGround` |
| Flèche — impact chair | chair | ✅ `projFlesh` k1 → `arrowFlesh` |
| Coup d'épée — swing | *whoosh* bandpass | ✅ `intSword` → `swordSwing` |
| Épée — touche / parade | chair / cliquetis | ✅ touche `intSword`→`swordHit` ; parade `intParry`→`shieldParry*` |
| **Obus paré — bouclier** (non létal) | 2 skins Hex/Vortex | ✅ `intParry` → `shieldParryHex`/`shieldParryVortex` (skin par biome) |
| **Obus — impact direct** (fatal) | barrière cède + **cri** | ✅ `intFatal` → `shieldFatal*` + `cry()` |
| Mort / à terre | cri descendant | ✅ couvert par `intFatal` + `cry()` |
| Réapparition / terraform / bâtir | adjacents | ✅ `apparition` + `glide` ; `intDig` (dig/fill/flat) ; `intBuild` (stairs/bridge) |

### Mousquetaire
| Déclenchement du tir | *crack* de silex, ≠ `boom` | ✅ `musket` → `musketCrack` |
| Passage de la balle | `whistles` zip aigu | ✅ `whistles` (freq 3000) |
| Impact sol | *pouf* / ricochet | ✅ `projGround` k0 → `ballGround` |
| Impact sur le mousquetaire | chair | ✅ `projFlesh` k0 → `flesh` |

### Grenadier
| Déclenchement (lob) | *thunk* sourd | ✅ `grenadeLob` → `grenadePin` |
| Passage (arc) | `whistles` lent/wobble | ✅ `whistles` (freq 900) |
| Impact / explosion | dérivé `explosion` | ✅ `grenadeBurst` → `grenadeBurst` + `grenadeShrapnel` |
| Impact sur le grenadier | chair + éclats | ✅ `projFlesh` → `flesh` |

### Canon de campagne
| Tir | `boom` variante roue | ✅ `fieldFire` → `fieldCannon` (moderne) |
| Boulet en vol | `whistles` grave | ✅ `whistles` (freq 600) |
| Impact sur tour | `hit` / `explosion` / `rubble` | ✅ via SFX duel : `hit()` conservé + `explosionModern`/`rubbleModern` (§3bis) |
| **Le canon lui-même détruit** | bois ≠ `rubble` pierre | ✅ `cannonWreck` → `woodSmash` |

### Tour (défense)
| Volée de mousqueterie (1–4 balles) | séquence de *cracks* | ✅ `towerVolley` (porte `n`) → `towerVolley` (cf. [battlefield-regles.md:35](battlefield-regles.md#L35)) |

---

## 2bis. Prototypés au lab (one-shots événementiels)

- **Soldats** : `melee-clash` (mêlée baïonnette), `soldier-death` (mort, court — léger car nombreux).
- **Intendant — actions** : `int-dig` creuser, `int-fill` remblayer, `int-flatten` aplanir, `int-stairs` escalier, `int-bridge` pont, `int-glider` planeur, `int-apparition` descente du ciel.
- **Fin de manche** : `horde-stampede` (piétinement de foule qui court), `horde-cry` (cri de victoire collectif), `desert-flag` (désertion — **priorité basse**, préférer **1 cue collectif** à la désertion de masse plutôt qu'un son par soldat).

## 3. Notes d'architecture

1. **`whistles()` est déjà la brique « passage de projectile »** — l'alimenter avec balles/flèches/grenades/boulets (freq par type via `WHISTLE_FREQ`). Colle à la simplification *« une seule brique unité-à-distance »* ([battlefield-regles.md:170](battlefield-regles.md#L170)) : un seul `rangedShot({kind})` → variations *fire / whizz / impact*.
2. **Spatialisation** : chaque son passe par `source → gain(depth) → highshelf(+tilt) → lowshelf(−tilt) → StereoPanner(pan) → master`, et est capté par le micro de l'acteur (tour fixe pour les soldats, **avatar mobile** pour l'Intendant). Les impacts chair sont la nouveauté de timbre.
3. **Sifflement = proximité, pas Doppler (modèle retenu)** : `proximity()` donne `intensity = 1 − dist/portée` ; `whistles()` en tire **volume** (`i × 0.13`) **et hauteur** (`base × (0.7 + i × 0.6)`). Volume + pitch montent en approchant, redescendent en s'éloignant → ça *lit* comme un Doppler sans en être un (piloté par la distance, pas la vitesse radiale). **Choix : on garde ce modèle** (gratuit, homogène, pas de `PannerNode`/HRTF). Vrai Doppler envisageable plus tard *uniquement* sur les balles rapides si le pass-by sonne plat.
4. **Voix soutenue vs one-shot — deux familles** :
   - **Passage de projectile** = **voix soutenue continue** : un oscillateur par `id` (`osc.start()` sans `stop`), gain + freq mis à jour chaque frame par la proximité, fade-out quand le projectile quitte la bulle. **Ni boucle, ni durée fixe** — il tient tant que le projectile est capté (un projectile qui traîne siffle juste plus longtemps, sans couture). Le `dur` du lab pour ces sons n'est qu'une **approximation d'audition** du timbre.
   - **Tout le reste** (tir, impacts, swing/twang, grognement, cri, explosion, fracas) = **one-shot événementiel**, déclenché une fois par événement ; là le `dur` est réel.
5. **Politique de voix (mix) — préconisation** : le « top-N brut » ne suffit pas. Pipeline retenu :
   1. **Cull distance d'abord** : émetteur hors portée du micro → ignoré (déjà fait pour `whistles`).
   2. **Score = volume × atténuation spatiale** (proximité au micro de l'écouteur), **pas** le volume brut → un mousquet proche prime sur une explosion lointaine.
   3. **Budgets PAR catégorie** (pas un seul top global) : sifflements ~4 (déjà par-id), impacts/explosions ~3, armes légères (mousquet/balle/mêlée) ~4 **avec fusion**, voix (cri/râle) ~2.
   4. **Fusion des quasi-simultanés** (~30–40 ms + positions proches) → **1 voix** (léger détune + gain) au lieu de N → tue la bouillie de volée et économise le CPU.
   5. **Plancher de priorité** (slots réservés, jamais cullés) : obus qui touche/tue l'Intendant, parade de bouclier, tour détruite, **stingers méta**.
   6. **Backstop global** ~10–12 voix simultanées : au-delà, couper les plus faibles **après** atténuation. (Le « top-8 » devient juste ce filet de sécurité, pas la stratégie principale.)

---

## 3bis. Décisions audio (validées au lab)

Direction **moderne** (sub + transient + saturation douce + réverb synthétique) retenue ; les sons d'origine deviennent **dépréciés** pour ces finalités :

| Finalité | Retenu | Rejeté / déprécié |
|---|---|---|
| Tir gros canon | `mod-cannon` (moderne) | ~~`boom()` / `ex-boom`~~ |
| Impact d'obus | `mod-explosion` (moderne) | ~~`explosion()` / `ex-explosion`~~ |
| Effondrement de tour | `mod-rubble` (moderne) | ~~`rubble()` / `ex-rubble`~~ |
| Tir canon de campagne | `cannon-fire-modern` (moderne) | ~~`cannon-fire` (boom + roue)~~ |
| **Sifflement d'obus** | **`whistles()` / `ex-whistle` (existant)** | ~~`mod-whistle` (moderne)~~ |
| **Tour touchée** | **`hit()` / `ex-hit` (existant)** | ~~`mod-hit` (moderne)~~ |

→ Le moderne est retenu pour le **gros bruit grave** (canon, explosion, effondrement) ; l'**existant** est conservé pour le **sifflement** et le **coup métallique** sur tour.

**Boucliers magiques** : deux skins — **Hexagonal/égide** (`parry-hex` / `fatal-hex`) et **Vortex** (`parry-vortex` / `fatal-vortex`). **DÉCIDÉ : skin par biome** (comme l'avatar Robe/Mascotte) — `biomes.js intendantShield` : vortex sur **volcano**, égide ailleurs. Le câblage (Lot D) choisit le SFX sur ce critère.

> Réglages fins validés : stockés comme **valeurs par défaut** dans `battlefield-sfx-lab.html` (bouton *Copier TOUS les réglages* pour le JSON complet).

## 4. Validé au lab & porté dans `Sfx.js` (✅ livré + câblé)

- [x] Timbre **chair** générique (`flesh`) — base partagée soldats + Intendant (`arrowFlesh` en dérive).
- [x] **Grognement / cri** de l'Intendant (`grunt` touché via `intHurt` / `cry` mort via `intFatal`).
- [x] **Crack de mousquet** (`musketCrack`) distinct du canon.
- [x] **Twang d'arc** (`bowTwang`) + impact flèche sol/chair (`arrowGround` / `arrowFlesh`).
- [x] **Swing + touche d'épée** (`swordSwing` + `swordHit`, via `intSword`).
- [x] **Lob + burst de grenade** (`grenadePin` + `grenadeBurst` + `grenadeShrapnel`).
- [x] **Fracas de bois** (`woodSmash`, via `cannonWreck`).
- [x] **Volée de meurtrière** (`towerVolley`, `n` 1-4).
- [x] Réglages portés dans `Sfx.js` (mêmes primitives oscillateurs + bruit filtré).

> Reste hors §2/§4 : **désertion** (`flag` synthétisé mais pas encore émis — 1 cue collectif, priorité basse).

---

## 5. Implémentation — plan par lots

> Prérequis déjà acquis : feature **livrée** (v2.0.0) + **canal d'évènements** en place qui pilote déjà les SFX du duel.
> **État (2026-06-22)** : **lots A → E tous livrés** (détail par lot ci-dessous). Voir aussi le dispatcher central `playEvent` (Lot E) et la politique de voix.
> **MàJ (2026-06-22, 2ᵉ passe)** : câblage des **timbres orphelins** — 9 nouveaux events ajoutés (append-only) à `EVENT_TYPES` + `playEvent` : `projGround`/`projFlesh` (impacts sol/chair, par `kind`), `intBow`/`intSword`/`intHurt` (arc/épée/cri de l'Intendant, à son micro), `towerVolley` (volée de meurtrière, `n` 1-4), `apparition`/`glide` (entrée du ciel / planeur), `cannonWreck` (canon de campagne détruit → `woodSmash`). Plus enrichissements sans nouvel event : `intFatal` ajoute `cry()`, `grenadeBurst` ajoute `grenadeShrapnel()`. Émis depuis `sim/battlefield.js`, dispatchés dans les 3 scènes, **round-trip codec re-testé OK**. **Reste** : bascule moderne du duel (§3bis), validations lab (§4), désertion (`flag`, encore non émise).

- **Lot A — Infra `Sfx.js`** ✅ **FAIT** : `reverb()` (bus convolver + impulsion générée), `shaper(k)` (waveshaper), `spatial(pos, revAmt)` (chaîne `depth → tilt → pan → master`, renvoie `null` hors portée micro), `setListener({mode:'tv'|'mic',…})` + const `SPACE`. Additif (sons du duel inchangés), build + tests verts. **Reste (→ Lot D)** : les scènes appellent `setListener` chaque frame (micro mobile P3 alimenté).
- **Lot B — Port des timbres** ✅ **FAIT (non committé)** : ~30 méthodes dans `Sfx.js`, chacune `(p = {défauts validés}, out = master)` :
  - modernes : `boomModern` / `explosionModern` / `rubbleModern` / `fieldCannon` ;
  - chair & voix : `flesh` / `voice` / `grunt` / `cry` / `soldierDeath` ;
  - Intendant armes : `swordSwing` / `swordHit` / `bowTwang` / `arrowGround` / `arrowFlesh` ;
  - soldats : `musketCrack` / `ballGround` / `grenadePin` / `grenadeBurst` / `grenadeShrapnel` / `woodSmash` / `melee` / `towerVolley` (`_shotgun`) ;
  - actions Intendant : `dig` / `fill` / `flatten` / `stairs` / `bridge` / `gliderDeploy` / `apparition` ;
  - fin de manche : `stampede` / `hordeCry` / `flag` ;
  - bouclier : `shieldParryHex` / `shieldParryVortex` / `shieldFatalHex` / `shieldFatalVortex`.
  Build + tests verts. **Le *passage* de projectile (balle/flèche/boulet) n'est PAS ici** → il reste sur `whistles()` (voix soutenue), alimenté au Lot D.
- **Lot C — Évènements** ✅ **FAIT (non committé)** : 11 types ajoutés (append-only) à `EVENT_TYPES` — `musket`, `grenadeLob`, `grenadeBurst`, `fieldFire`, `melee`, `soldierDeath`, `intParry`, `intFatal`, `intBuild`, `intDig`, `horde` — émis depuis `sim/battlefield.js` (`_ev`/`drainEvents`), drainés par `Simulation` après `battlefield.step`, encodés/décodés dans `snapshotCodec` (payloads `x,y[,owner|kind]`). `melee` throttlé (0,3 s, côté owner 0). **Round-trip testé** (codec.test §d, 19 verts), build OK. *Désertion : non émise (priorité basse — 1 cue collectif plus tard).*
- **Lot D — Câblage** ✅ **FAIT (non committé)** : les 11 events sont traités dans `TvScene.processEvents` (mode `tv`, plein arène), `ControllerScene.feedback` (micro à la tour, `range` 560 → actions centrales cullées), `IntendantScene.feedback` (**micro mobile** `setListener` sur `bf.intendant.x/y`, `range` 320). Chaque son passe par `spatial()` ; skin de bouclier choisi par biome (`intendantShield` / `biomeId==='volcano'` → vortex). Build + tests verts.
- **Lot D.2 — sifflement des projectiles battlefield** ✅ **FAIT (non committé)** : `id` stable ajouté aux projectiles (sim lazy + codec u32, round-trip OK) ; `ControllerScene.proximity` (micro tour) et `IntendantScene` (micro mobile) alimentent `whistles()` avec les projectiles battlefield, freq par type (musket 3000 / fromI 1500 / bolt 1800 / gren 900 / boulet 600), id namespacé `b<id>`. Le passage reste une **voix soutenue** par projectile.
- **Lot E — Politique de voix** ✅ **FAIT (non committé)** : bus `sfxBus` duckable (toute la couche living-world y passe via `spatial()`/`reverb()` ; le duel reste sur master, intact) ; `gate(cat, loudness)` — budgets par catégorie sur fenêtre 50 ms (`impact` 3, `smallarm` 4, `voice` 2 ; `shield`/`meta` = plancher), au-delà on garde le **plus fort après atténuation** ; `duck()` (sidechain-lite, dip à 55 % / 160 ms) déclenché par `impact`+`shield` ; **dispatcher central `playEvent(e, out, {skinVortex})`** → les 3 scènes ne font plus que `spatial()` + visuels. Build + tests verts.

**Ordre conseillé** : A → B → C → D → E. **Lot B est sûr (additif)** et peut démarrer en parallèle de A.

---

## 6. Chantier audio — terminé (A → E + D.2)
Tout le pipeline est en place : **feature v2.0.0** → **évènements** (sim+codec) → **drain** (Simulation) → **câblage 3 scènes** (TV / micro-tour / micro-mobile P3) → **timbres** (Sfx) spatialisés + réverbérés → **politique de voix** (gate + duck). Lots A & mêlée **committés** dans `ab63075` ; B/C/D/D.2/E **non committés** (working tree). **Reste, optionnel** : désertion (cue collectif), stingers méta (podium-à-3 / MVP / connexion P3), et le **commit** de B→E.

### Fait (hors audio, lié)
- **IA mêlée** : un mousquetaire en **recharge** dont un ennemi entre en **distance de charge** (`chargeRange` 70) **charge à la baïonnette** au lieu de rester planté (`sim/battlefield.js`). Tests verts.
