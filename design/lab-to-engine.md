# Lab → Engine : document de portage du Battlefield

Portage du prototype validé `design/battlefield-lab.html` (v5, simulation dans l'IIFE `<script>`, ~l.125–1140, objet de config `C={...}` aux l.133–159) vers le moteur réel `src/sim/battlefield.js` (classe `Battlefield`). Le **lab est la source de vérité du gameplay** ; le moteur est en retard et reste la **cible**.

Convention : prose en français, noms de code/params en anglais. Aucune modification de code dans ce document — il décrit *quoi* porter et *comment*.

Contexte d'intégration (déjà en place, ne pas refaire) :
- `src/sim/Simulation.js` construit le `Battlefield` (`buildBattlefield()`, l.197) avec une seed dérivée du terrain (`seed ^ 0x9e3779b9`) et un **adaptateur `world`** (`battlefieldWorld()`, l.165) : `width/height`, `platformWidth`, `towerX`, `craterR`, `heightAt(x)`, `carveCrater(mx,my,r)`, `dig/bash/fill/flatten`, `editColumn()` (no-op marqueur). `syncCannon=true` : la cadence du canon d'escalade est asservie à l'artillerie réelle.
- Le moteur **ne régénère jamais** le terrain : il lit/écrit le heightfield partagé via `world`. `terrain.js` fournit `heightAt(heights,x)`. `Simulation.carveTerrain(mx,my,r)` (l.583) creuse un **bol circulaire** simple (pas de saucer/aval/lèvre) et pousse dans `this.craters`.
- Le moteur émet déjà des `events` one-shot (`_ev`) drainés par `Simulation` (audio/vfx), et un `snapshot()` compact pour la TV.

---

## A. Tableau complet des paramètres `C` du lab

Valeurs lab = `C={...}` (l.133–159). État moteur = `DEFAULT_PARAMS` (`battlefield.js` l.28–60).

Légende état : **=** présent et identique · **≠** présent mais valeur/sens différent · **✗** absent du moteur · **MORT** param retiré du lab (à ne pas réintroduire).

| Clé | Valeur lab | Rôle (1 ligne) | Moteur |
|---|---|---|---|
| `v0` | 40 | Vitesse de marche de base (px/s) sur plat, commune à tous. | ≠ (moteur 70) |
| `fallHmin` | 7 | Chute : hauteur de descente (px) sous laquelle proba 0 %. | ✗ (modèle de chute différent) |
| `fallHmax` | 26 | Chute : hauteur (px) à partir de laquelle proba 100 %. | ✗ |
| `fallDmg` | 2.5 | Dégât de base par unité de hauteur chutée. | ≠ (moteur 3) |
| `engage` | 12 | Portée de FRAPPE de la baïonnette (contact). | ≠ (moteur 14) |
| `sHp` | 4 | PV du mousquetaire. | = |
| `spacing` | 18 | Distance min entre deux soldats d'un même type/file. | = |
| `spawnFreq` | 4.4 | Mode Auto : intervalle (s) entre émissions par camp. | ≠ (moteur 6) |
| `doorT` | 0.26 | Durée (s) de sortie de porte. | ≠ (moteur 0.25) |
| `archerPct` | 0.12 | Proba qu'un soldat émis soit un grenadier (sinon mousquet.). | ≠ (moteur 0.1) |
| `arHp` | 2 | PV du grenadier. | = |
| `arDmg` | 3 | Dégât / éclat de grenade. | ≠ (moteur 1) |
| `arRange` | 80 | Portée de lancer de la grenade (activation = tir). | ≠ (moteur 140) |
| `desertT` | 4 | Temps (s) bloqué avant désertion. | = |
| `repTime` | 4 | Combat stérile (s) avant repositionnement. | ✗ |
| `musRange` | 160 | Portée du mousquet (acquisition + tir). | = |
| `musDmg` | 3 | Dégât d'une balle de mousquet. | = |
| `chargeRange` | 70 | Portée d'ACTIVATION de la baïonnette (charge). | = |
| `ballDmg` | 4.5 | Dégât direct du boulet (vaporise les soldats). | ≠ (moteur 2) |
| `splashFactor` | 0.5 | Fraction de dégât d'explosion hors contact (souffle). | = |
| `musAcc` | 0.78 | Proba qu'un tir mousquet soit ajusté (vs raté). | = |
| `musSpread` | 0.045 | Dispersion angulaire (rad) d'un tir ajusté. | = |
| `musMissSpread` | 0.22 | Dispersion angulaire (rad) d'un tir raté. | = |
| `musDmgVar` | 1.0 | Variance de dégât mousquet (±moitié). | = |
| `bowAcc` | 0.76 | Proba qu'un tir d'arc Intendant soit ajusté. | ≠ (moteur 0.85) |
| `bowSpread` | 0.035 | Dispersion (rad) tir d'arc ajusté. | = |
| `bowMissSpread` | 0.31 | Dispersion (rad) tir d'arc raté. | ≠ (moteur 0.18) |
| `bowDmgVar` | 0.85 | Variance de dégât d'arc (±moitié). | ≠ (moteur 0.35) |
| `pathCongestion` | 3.5 | Surcoût pathfinding sur colonnes saturées (anti-bouchon). | = |
| `pathJitter` | 0.4 | Bruit par soldat sur le chemin (éventaillage). | ≠ (moteur 0.18) |
| `slopeFx` | 0.25 | **Effet de pente sur la vitesse** : `clamp(1−|pente|·slopeFx, 0.4, 1.4)`. | ✗ (codé en dur 0.25 ; voir B) |
| `ballSpeed` | 470 | Vitesse du boulet de canon (px/s). | ✗ (codé en dur 474) |
| `musSpeed` | 480 | Vitesse de la balle de mousquet (px/s). | ✗ (codé en dur 480) |
| `bowSpeed` | 440 | Vitesse de la flèche d'arc Intendant (px/s). | ✗ (codé en dur 440) |
| `boltSpeed` | 380 | Vitesse des projectiles de tour (px/s). | ✗ (codé en dur 380/474) |
| `grenTime` | 0.6 | Temps de vol (s) de la grenade lobée. | ✗ (codé en dur 0.6) |
| `grenLob` | 120 | Portée de lob par défaut (px) sans cible précise. | ✗ |
| `mqSpdMul` | 1 | Mult. vitesse mousquetaire. | ✗ |
| `mqFallMul` | 1 | Mult. dégât chute mousquetaire. | ✗ |
| `grSpdMul` | 1.15 | Mult. vitesse grenadier. | ✗ |
| `grFallMul` | 0.9 | Mult. dégât chute grenadier. | ✗ |
| `caSpdMul` | 0.4 | Mult. vitesse canon (×0.4 d'origine). | ✗ (codé en dur 0.4) |
| `caFallMul` | 2.5 | Mult. dégât chute canon (×2.5 d'origine). | ✗ (codé en dur 2.5) |
| `enSpdMul` | 0.9 | Mult. vitesse ingénieur. | ✗ |
| `enFallMul` | 1.5 | Mult. dégât chute ingénieur. | ✗ |
| `sJump` | 10 | Saut de base (px) : marche d'escalade = `SU(14)+sJump×coeff`. | ✗ |
| `mqJumpMul` | 1 | Mult. saut mousquetaire. | ✗ |
| `grJumpMul` | 1 | Mult. saut grenadier. | ✗ |
| `caJumpMul` | 0 | Mult. saut canon (0 = ne saute pas). | ✗ |
| `enJumpMul` | 1 | Mult. saut ingénieur. | ✗ |
| `cataHp` | 5 | PV du canon. | ✗ (codé en dur `hp=8`) |
| `engHp` | 3 | PV de l'ingénieur. | ✗ (pas d'ingénieur au moteur) |
| `engBridgeMax` | 6 | Longueur max du pont (planches). | ✗ |
| `engLadH` | 40 | Hauteur max d'une échelle inclinée (px). | ✗ |
| `engLadRun` | 52 | Fuyant max d'une échelle (px) — règle l'inclinaison. | ✗ |
| `cataRange` | 240 | Portée d'activation du canon vs tour adverse. | ✗ (codé en dur 240) |
| `towerDmg` | 99 | Dégât d'un projectile de tour (99 ≈ one-shot). | ✗ (codé en dur `s.hp=0`) |
| `towerBolts` | 4 | Nb max de projectiles par salve (1..N). | ✗ (codé en dur `floor(rnd()*4)`) |
| `intSpeed` | 120 | Vitesse de l'Intendant (px/s). | ≠ (moteur 150) |
| `jumpV` | 240 | Impulsion verticale du saut Intendant. | ≠ (moteur 280) |
| `glide` | 55 | Vitesse de chute plafonnée en plané. | = |
| `climbSpeed` | 10 | Vitesse d'escalade (échelle/pente raide). | ≠ (moteur 15) |
| `swordR` | 28 | Rayon de frappe de l'épée Intendant. | ≠ (moteur 30) |
| `swDmg` | 4 | Dégât / coup d'épée. | ≠ (moteur 5) |
| `bowDmg` | 2.5 | Dégât d'une flèche d'arc Intendant. | ≠ (moteur 3) |
| `bowRange` | 210 | Portée de l'arc Intendant (activation = tir). | ≠ (moteur 240) |
| `digSpeed` | 40 | Vitesse de creuse/remblai du terrain. | = |
| `digH` | 4 | **Profondeur/hauteur (px) d'un coup de creuse/remblai**. | ✗ (moteur : `9` codé en dur dans `world.dig`) |
| `buildSteps` | 4 | Longueur d'un ouvrage Intendant (nb d'éléments). | = |
| `grav` | 900 | Gravité (px/s²). | = |
| `climbSlope` | 1.3 | Pente max franchissable à pied. | ≠ (moteur 1.35) |
| `maxHp` | 3 | PV des tours ET de l'Intendant (même réserve). | = (overridé par `Simulation`) |
| `towerWarn` | 150 | Rayon d'alerte de la tour. | = |
| `towerFire` | 95 | Rayon de tir effectif de la tour. | = |
| `towerRate` | 1.6 | Cadence de tir de la tour (tirs/s). | = |
| `craterR` | 24 | Rayon de cratère par DÉFAUT (outil manuel / repli). | ≠ (moteur 34, + overridé par `world.craterR`) |
| `ballCraterR` | 24 | **Rayon de cratère du boulet** (× handicap pente pour le canon). | ✗ (canon utilise `C.craterR`) |
| `grenCraterR` | 9 | **Rayon de cratère de la grenade** (indépendant). | ✗ (grenade utilise `craterR*0.35`) |
| `shieldR` | 54 | Rayon d'interception du bouclier magique. | ≠ (moteur 42) |
| `shieldDur` | 1.5 | Durée (s) d'une activation du bouclier. | = |
| `bayoDmgVar` | 0.3 | Variance dégât baïonnette (±moitié). | ✗ |
| `grenDmgVar` | 1.5 | Variance dégât grenade (±moitié). | ✗ |
| `ballDmgVar` | 0.5 | Variance dégât boulet (±moitié, sur Intendant & souffle). | ✗ |
| `swDmgVar` | 0.45 | Variance dégât épée (±moitié). | ✗ |
| `bayoWind` | 0.15 | Mousquetaire baïonnette : attente avant (s). | ✗ |
| `bayoRec` | 0.45 | Baïonnette : attente après (s). | ✗ |
| `bayoDmg` | 2 | Dégât PAR COUP de baïonnette. | ✗ (moteur : DPS continu `sDps`, voir MORTS) |
| `musWind` | 0.6 | Mousquet : visée avant tir (s). | ✗ |
| `musRec` | 1.6 | Mousquet : recharge après tir (s). | ✗ (moteur : `musReload` mort) |
| `grenWind` | 0.6 | Grenadier : armement avant lancer (s). | ✗ |
| `grenRec` | 0.15 | Grenadier : après explosion (s). | ✗ |
| `cataWind` | 2 | Canon : pointage avant tir (s). | ✗ (moteur : `ft>=2.4` codé en dur) |
| `cataRec` | 1.6 | Canon : après tir (s). | ✗ |
| `engWind` | 0.3 | Ingénieur : avant chantier (s). | ✗ |
| `engRec` | 0.3 | Ingénieur : après chantier (s). | ✗ |
| `engDur` | 0.22 | Ingénieur : délai par planche/échelon (s). | ✗ |
| `swWind` | 0.2 | Intendant épée : attente avant (s). | ✗ |
| `swRec` | 0.3 | Épée : attente après (s). | ✗ |
| `bowWind` | 0.25 | Intendant arc : visée avant (s). | ✗ (moteur : `bowRate` mort) |
| `bowRec` | 0.3 | Arc : attente après (s). | ✗ |
| `toolWind` | 0.18 | Modelage : attente avant (s). | ✗ (moteur : `effort` mort) |
| `toolRec` | 0.18 | Modelage : attente après (s). | ✗ |
| `toolDur` | 0.12 | Modelage : durée d'un coup (s). | ✗ |
| `buildWind` | 0.25 | Construction : attente avant (s). | ✗ (moteur : `buildInterval` mort) |
| `buildRec` | 0.3 | Construction : attente après (s). | ✗ |
| `buildDur` | 0.26 | Construction : délai par élément (s). | ✗ |

### Les 7 params MORTS — NE PAS réintroduire

Ils existent encore dans `DEFAULT_PARAMS` (`battlefield.js` l.29–53) mais ont été **retirés du lab**. Le code moteur qui les lit doit migrer vers le nouveau modèle (colonne « remplacé par ») :

| Param mort (moteur) | Valeur moteur | Remplacé par |
|---|---|---|
| `slopeK` | 2.35 | `slopeFx` (effet de pente réglable, formule `clamp(1−|pente|·slopeFx,0.4,1.4)`). |
| `sDps` | 2.4 | Baïonnette PAR COUP : `bayoDmg`+`bayoWind`/`bayoRec` (modèle FSM, plus de DPS continu). |
| `arRate` | 1.2 | Grenadier en FSM : `grenWind`/`grenRec`+`grenTime` (plus de cadence continue). |
| `musReload` | 2.2 | `musWind`/`musRec` (visée + recharge séparées). |
| `bowRate` | 2.5 | `bowWind`/`bowRec` (Intendant arc en FSM). |
| `effort` | 0.18 | `toolWind`/`toolDur`/`toolRec` (modelage en 3 phases). |
| `buildInterval` | 0.24 | `buildWind`/`buildDur`/`buildRec` (construction en 3 phases). |

---

## B. Mécaniques ajoutées / changées dans le lab

Pour chacune : ce que ça fait · où dans le lab · ce qu'il faut faire côté moteur.

### B1. Modèle de CHUTE — proba LINÉAIRE (remplace `steepDown`+`fallProb`)

- **Ce que ça fait** : pendant la descente, on accumule `descAcc` chaque frame où `drop>1.5` px. À la fin de la descente, proba de culbute = `clamp((descAcc−fallHmin)/(fallHmax−fallHmin), 0, 1)` (0 % à `fallHmin=7`, 100 % à `fallHmax=26`). Si `rnd()<prob` → dégât `fallDmg·descAcc·0.1·fallMul(kind)`, récupération `s.recover=min(2.2, descAcc·0.03)`, `s.fall=true`. Sinon descente maîtrisée, aucun dégât. La chute est un **suicide** (pas de ressource Intendant).
- **Où** : `stepSoldiers`, l.797–804. Accumulation l.798, proba/dégât l.800–803.
- **Côté moteur** : remplacer le bloc `battlefield.js` l.897–906 (`if (s.descAcc > C.steepDown * SU && this.rnd() < C.fallProb)`) par la **formule linéaire**. Ajouter `fallHmin`/`fallHmax` aux params, retirer `steepDown`/`fallProb`. Remplacer le `(s.kind==='cata'?2.5:1)` par `fallMul(s.kind)` (voir B2). Le moteur a déjà `descAcc`, `recover`, `s.fall`.

### B2. DÉPLACEMENT par unité (léger) — multiplicateurs par TYPE

- **Ce que ça fait** : base globale `v0`/`fallDmg`/`sJump` × multiplicateurs par type. Helpers : `spdMul(k)`, `fallMul(k)`, `jumpMul(k)` renvoient 1 par défaut (horde sans `kind`), `climbStep(k)=SU+C.sJump·jumpMul(k)`. Tables de mapping `_SPDMUL/_FALLMUL/_JUMPMUL` (sword→mq, bow→gr, cata→ca, engineer→en). Le canon porte ses anciens facteurs : `caSpdMul=0.4`, `caFallMul=2.5`, `caJumpMul=0`.
- **Où** : helpers l.160–165 ; usages l.777 (`spdMul(s.kind)`), l.792 (`vmul=spdMul(s.kind)*(s.horde?1.8:1)`), l.802 (`fallMul`).
- **Côté moteur** : ajouter les 12 params `{mq,gr,ca,en}{Spd,Fall,Jump}Mul`, les 3 tables et les 3 helpers (méthodes ou fonctions module). Remplacer les facteurs codés en dur : `battlefield.js` l.890 `vmul = s.kind === 'cata' ? 0.4 : (s.horde ? 1.8 : 1)` → `spdMul(s.kind)*(s.horde?1.8:1)` ; l.880 `*(cata?0.4:1)` → `*spdMul(s.kind)` ; l.903 `(s.kind==='cata'?2.5:1)` → `fallMul(s.kind)`. **Attention** : le moteur ne crée pas d'`engineer` aujourd'hui (B8) ; prévoir le mapping même si non instancié.

### B3. SAUT des soldats — arc balistique

- **Ce que ça fait** : un ressaut montant juste devant (`rise=s.y−groundY(s.x+dir*5)`) qui dépasse `SU(14)` mais reste `≤ climbStep(kind)+2` déclenche un saut : impulsion `s.jvy=−√(2·g·(rise+8))`, direction `s.jdir=dir`, `st='jump'`. Tant que `s.jvy!=null` : `x+=jdir·v0·0.7·dt`, gravité `jvy+=grav·dt`, atterrissage quand `jvy>0 && y>=groundY` (→ `jvy=null`). Le canon ne saute pas (`jumpMul('cata')=0`).
- **Où** : déclenchement l.786–789 ; intégration de l'arc l.716–720 (en tête de `stepSoldiers`).
- **Côté moteur** : ajouter l'état `s.jvy/s.jdir` et le bloc d'arc en tête de la boucle `stepSoldiers` (avant l'aiguillage d'état). Ajouter le test de déclenchement juste après la lecture du waypoint (équivalent l.786–789, à insérer vers `battlefield.js` l.886). **Dépendance forte** : le **pathfinding doit accepter `climb`** par soldat (B3-bis), sinon le soldat ne sait pas qu'une marche `>SU` est franchissable.

### B3-bis. A* avec `climb` par soldat

- **Ce que ça fait** : `findPath(...,{climb})` (défaut `SU`). Une marche montante `up>climb+1` est infranchissable (l.334) ; un vrai saut au-delà de `SU` ajoute un surcoût `(up−SU)*0.8` (l.335). Appel : `findPath(...,{climb:climbStep(s.kind)})` (l.772).
- **Où** : signature l.324, coût l.334–335, appel l.772.
- **Côté moteur** : `battlefield.js` `findPath` (l.232) — ajouter `climb=SU` aux opts, changer `if (up > SU + 1) continue` (l.269) en `if (up > climb + 1) continue`, ajouter le terme `+(up>SU?(up-SU)*0.8:0)` au coût (l.271), et passer `climb: climbStep(s.kind)` à l'appel (l.871). Le lab gère aussi les **échelles** dans `findPath` (l.340–342) ; cf. B8.

### B4. REPOSITIONNEMENT (combat stérile) — ✅ PORTÉ (variante par unité)

- **Ce que ça fait** : si `st==='fight'`, on cumule `s.fightT`. Quand `fightT>repTime` → reset `fightT`, `s.pushT=repPush`, `s.path=null` : courte poussée en avant + replanification. Pendant `pushT` (`s.pushT-=dt`), le soldat saute l'aiguillage de combat (`if(interact && !pushing)`).
- **Où (lab)** : l.734–737 (constante `C.repTime=4`).
- **Côté moteur (fait)** : params `repTimeMin:1, repTimeMax:4, repPush:0.7` ; état `s.fightT/s.pushT` ; bloc inséré juste avant l'aiguillage de combat dans `stepSoldiers` (après le dispatch ingénieur). **Variante demandée** : `repTime` n'est plus une constante mais **par unité, tiré dans `[repTimeMin, repTimeMax)` = [1, 4)** dans `newSoldier` via `hash2(jseed, …)` — déterministe (seed + ordre de spawn), zéro `Math.random`. Pas de dépendance à la FSM (#9) : le moteur n'a pas d'`s.act` soldat, donc on annule simplement `s.path` (la cadence `s.ft` reprend après la poussée).

### B5. Coefficient d'EFFET DE PENTE `slopeFx`

- **Ce que ça fait** : facteur de vitesse `= clamp(1−|pente|·slopeFx, 0.4, 1.4)`, jadis `0.25` figé. Réglable.
- **Où** : usages l.777, l.793, l.709 (player), l.880 lab. (Le lab garde `0.25` à un endroit ; partout où il y avait `0.25` figé doit lire `C.slopeFx`.)
- **Côté moteur** : remplacer les `1 - Math.abs(...)*0.25` dans `stepSoldiers` (`battlefield.js` l.880, l.891) par `C.slopeFx`. Ajouter le param `slopeFx`, retirer `slopeK` (mort). NB : l'Intendant utilise un facteur distinct `0.45` (l.579 lab / `battlefield.js` l.669) — **ne pas** confondre, c'est un coefficient à part non exposé.

### B6. FSM d'action chronométrée (Wind → effet → Rec) — toutes les armes

- **Ce que ça fait** : remplace les cadences continues par une machine à 3 phases. Helper `actTick(u,field,dt,wind,rec,onStart,onFire)` (l.692–696) : crée `u[field]={ph:0,t:wind}`, capture la cible (`onStart`), `onFire` une fois à fin de Wind, libère à fin de Rec. L'unité reste **immobile/engagée** tant que `u[field]` existe. Utilisé par : baïonnette (`bayoWind/Rec/Dmg`, l.754–755), mousquet (`musWind/Rec`, l.760–761), grenade (`grenWind/Rec`, l.749–750), canon (`cataWind/Rec`, l.744), épée Intendant (`swWind/Rec/Dmg`, l.652), arc Intendant (`bowWind/Rec`, l.657), modelage (`toolWind/Dur/Rec`, l.562–566), construction (`buildWind/Dur/Rec`, l.451–461).
- **Où** : `actTick` l.692–696 ; usages cités ci-dessus.
- **Côté moteur** : ajouter `actTick` (méthode), l'état `s.act`/`I.atk`, tous les params `*Wind/*Rec/*Dur/*Dmg`. Réécrire les blocs de combat de `stepSoldiers` (`battlefield.js` l.844–858 actuels — DPS continu baïonnette, cadence `1/arRate`, `musReload`, `ft>=2.4`) en FSM. Idem `autoAttack` (l.702–717) et `stepBuild` (l.413–427, déjà partiel : ajouter Wind/Rec autour). **Important** : la baïonnette passe d'un DPS continu mutuel (`sDps*dt` sur foe ET self, l.852 moteur) à un coup unique par cycle sur le foe seul — changement de feel à valider.

### B7. VITESSES de projectiles + grenade

- **Ce que ça fait** : `ballSpeed/musSpeed/bowSpeed/boltSpeed` remplacent les vitesses figées. Grenade : `grenTime` (temps de vol, détermine la cloche) et `grenLob` (portée de lob par défaut sans cible précise, mode player).
- **Où** : boulet `sp=C.ballSpeed` (l.742, l.704) ; mousquet `C.musSpeed` (l.761, l.707) ; arc `C.bowSpeed` (l.657) ; tour `C.boltSpeed` (l.612) ; grenade `t=C.grenTime` (l.750) ; `grenLob` (l.705).
- **Côté moteur** : exposer ces 4 vitesses + `grenTime`/`grenLob`. Remplacer dans `battlefield.js` : boulet `sp=474` (l.838) → `C.ballSpeed` ; mousquet `*480` (l.858) → `C.musSpeed` ; arc `*440` (l.715) → `C.bowSpeed` ; tour `*380` (l.740) → `C.boltSpeed` ; grenade `t=0.6` (l.848) → `C.grenTime`. `grenLob` n'a pas d'équivalent moteur (pas de mode player) — ajouter pour cohérence/futur.

### B8. CANON & INGÉNIEUR — PV exposés + ouvrages ingénieur

- **Canon** : PV `cataHp=5` (lab) vs `hp=8` codé en dur (`battlefield.js` l.303). Activation `cataRange=240` (l.744) vs `< 240` figé (l.830). → exposer `cataHp`, `cataRange`.
- **Ingénieur** : **absent du moteur**. Le lab a un type `engineer` (non-combattant) qui pose des ouvrages GRATUITS puis déserte :
  - PV `engHp=3` ; pont `engBridgeMax=6` planches (`PW=16`) ; échelle inclinée `engLadH=40`×`engLadRun=52`.
  - Logique de décision : `planEngineer(owner)` (l.409–413) appelle `buildPlan` (1re arête nette : chute>SU→pont, ressaut>SU→échelle, l.399–404) et `navReach` (DFS de portée, l.382–394). Un ingénieur sort **seulement** si l'ouvrage étend la portée de plus d'une maille (`rT>base+8`). `hasEngineer` empêche le doublon. Spawn : `newSoldier` l.416–421.
  - Exécution : `stepEngineer(s,dt,active)` (l.665–688) — approche, pose (FSM `engWind/engDur/engRec`), déserte. Échelles stockées dans `ladders[]` (état séparé), avec navigation A* (l.340–342) et `navReach` (l.391–393).
- **Côté moteur** : c'est le **plus gros chantier**. Ajouter le type `engineer`, l'état `this.ladders`, `planEngineer/buildPlan/navReach/hasEngineer/stepEngineer`, l'intégration `ladders` dans `findPath` + `surfacesAt`/`navY`, la destruction d'échelle dans `craterStructures` (l.476 lab), et le segment d'échelle dans `stepSoldiers` (l.780–785 lab, `st='climb'`). Exposer `engHp/engBridgeMax/engLadH/engLadRun`.

### B9. INTENDANT — `digH` + PV = `maxHp`

- **`digH`** : profondeur/hauteur réelle (px) d'un coup de creuse/remblai. Creuse : puits référencé au **rebord stable** `ref=min(terrAt(tx−rr−6),terrAt(tx+rr+6))`, profondeur au centre `ref+w·digH` (l.486–487) → l'Intendant peut s'enfoncer sans creuser à l'infini. Remblai : monticule, hauteur au centre `I.y−w·digH` (l.490).
- **Où** : `digDir` l.485–488, `fillDir` l.489–491.
- **Côté moteur** : aujourd'hui `world.dig` (Simulation l.179) utilise `w*9` figé et `fill` `ty−w*rr*0.85`. Le moteur appelle `world.dig(tx,ty,11,...)` (`battlefield.js` l.487) — il faut **propager `digH`** soit en l'ajoutant à la signature de `world.dig/fill`, soit en pré-calculant la profondeur dans `Battlefield`. Le rebord-stable référencé du puits (digger) n'existe pas côté moteur → à porter dans l'adaptateur `Simulation.battlefieldWorld()`.
- **PV Intendant** = `maxHp` (même réserve que les tours). Déjà le cas au moteur (`I.hp=this.C.maxHp`, l.153). RAS.

### B10. CRATÈRES RÉALISTES — `carveCrater(mx,my,r,vx,vy)` + rayons par munition

- **Ce que ça fait** : bol « saucer » (plus large que profond), elliptique/asymétrique, allongé & décalé vers l'**aval** selon l'horizontalité de l'impact `h=|vx|/vitesse` (0 vertical→rond, 1 rasant→ellipse). Lèvre d'éjectas asymétrique (plus marquée vers l'aval). Gerbe de terre biaisée downrange via `spawnDirt(...,bias=sgn·h)`. Détails : `depth=r·0.6·(1−0.3h)`, `rxF=r·(1+0.9h)` (aval), `rxB=r·(1+0.2h)` (amont), centre `cx=mx+sgn·r·0.3·h`, `lipH=min(6,depth·0.22)`.
- **Où** : `carveCrater` l.500–508 ; `spawnDirt` avec `bias` l.298 ; `explodeBall` passe `a.vx,a.vy` (l.512).
- **Rayons indépendants par munition** : `ballCraterR` (boulet ; `× pw` handicap de pente pour le canon, l.742/704) ; `grenCraterR` (grenade, l.705/750) ; `craterR` n'est plus que l'**outil manuel/défaut**. Les **tours ne cratérisent pas** (elles tirent des balles `bolt`, pas de `ball`).
- **Côté moteur** : `Battlefield.carveCrater(mx,my,r)` (l.516) appelle `world.carveCrater(mx,my,r)` → `Simulation.carveTerrain` (l.583) qui fait un **bol circulaire simple**. Pour porter le saucer : soit étendre la signature `carveCrater(mx,my,r,vx,vy)` jusqu'à `Simulation.carveTerrain` (préféré, car le heightfield est côté Simulation), soit accepter une approximation circulaire au moteur. `explodeBall` (l.529) doit transmettre `a.vx/a.vy`. Remplacer les rayons : boulet `cr: C.craterR*pw` (l.839) → `C.ballCraterR*pw` ; grenade `cr: Math.max(8,C.craterR*0.35)` (l.848) → `C.grenCraterR`. Exposer `ballCraterR/grenCraterR`. Adapter `spawnDirt` (côté rendu/Simulation) au `bias` — c'est un effet visuel, non critique sim.

### B11. CANON en parcours + rendu contrasté du boulet

- **Ce que ça fait** : en mode parcours, le canon tire **vers l'avant en cadence** (`cataT>=cataWind+cataRec`) sans s'arrêter (observation, l.743). Rendu du boulet : **traînée chaude** (segment `rgba(255,170,80,.4)` derrière) + corps sombre + **reflet** clair (`#cfc9bd`) pour le contraste sur fond sombre (l.1009–1012). Grenade : noire + mèche orange.
- **Où** : tir parcours l.743 ; rendu l.1009–1015.
- **Côté moteur** : le mode parcours est **outillage de lab**, pas prioritaire (le moteur n'a pas de `parcoursMode`). Le rendu (traînée/reflet) appartient à `BattlefieldView` (rendu Phaser), hors de `battlefield.js`. À noter pour la couche rendu, non bloquant pour la sim.

---

## C. Structure de l'ÉDITEUR du lab (outillage, séparable du gameplay)

Pour un éventuel panneau debug/tuning du moteur. **Non prioritaire** pour porter le gameplay.

- **Sections par unité** : onglets `Soldats` (sous-onglets Commun/Mousquetaire/Grenadier/Canon/Ingénieur), `Intendant`, `Monde`, `Parcours`. Construction déclarative depuis `GROUPS` (l.174–220) : `['clé','label',min,max,pas]`, marqueurs `['§','Titre']` (section), `['※','html']` (note read-only), `['⇄',specA,specB]` (paire côte à côte). `mkCtl` (l.280–286) génère slider+label+valeur.
- **Paires Dégât/Var.** : la convention `⇄` met Dégât et Var. dégât côte à côte (ex. `bayoDmg`/`bayoDmgVar`, `musDmg`/`musDmgVar`, `towerDmg`/`towerBolts`).
- **Info-bulles** : `DESC{}` (l.222–268) — texte `title` au survol, fallback = label.
- **OVERLAYS canvas** (déclenchés au réglage, fondu via `rangeHi`/`rangeHiT`, l.277, registre `SPATIAL` l.270–276) :
  - **Cercles de portée** (l.1076–1089) : autour de l'ancrage (`a:'sol'/'int'/'tower'`), rayon = `C[m.r]`, label `clé : Npx`.
  - **Cône de chute min→max** (l.1047–1060) : secteur depuis les pieds, angle `atan2(fallHmin,42)` → `atan2(fallHmax,42)`, secteur ombré = proba croissante.
  - **Aperçu d'échelle** de l'ingénieur (l.1061–1075) : montant incliné + barreaux + cotes hauteur×fuyant + angle.
  - **Marqueurs d'échelle/debug** : `Debug chemins` (chemins valides + pentes infranchissables, l.1023–1027), `Debug chutes` (`scanFalls`, zones à risque colorées ∝ proba + fanions de dégât, l.1028–1043).
- **Export/Import JSON** des paramètres, `Seed`, boutons de test (`Outil cratère`, `Canon (test)`, `Fin de manche`, `Obus → Intendant`).

À retenir : tout cela est de l'**outillage** (DOM + canvas overlays), totalement séparable du portage gameplay. Le seul lien utile est le registre `SPATIAL`/`DESC` si on veut un panneau de tuning live au moteur.

---

## D. CHECKLIST DE PORTAGE priorisée

Effort : **S** (≤ qq lignes / params), **M** (un bloc/fonction), **L** (sous-système).

> **État (2026-06)** : ✅ **#1–#15 portés et vérifiés** (gameplay sim + wire + rendu + audio). Reste **non porté (intentionnel)** : **#16/#17** (outillage éditeur du lab — mode parcours, panneau de tuning live ; non pertinents dans le moteur) et **#18** (biais visuel `spawnDirt` sans hook propre). Points notables : #11 `repTime` est **par unité ∈ [1,4) seedé** (pas une constante) ; #8 le saucer est **branché sur la vitesse** (le duel garde son bol rond) ; #9 la **FSM d'action** change le feel de la baïonnette (coup-par-coup) — **à valider en playtest**. Vérifs : tests verts (battlefield 14/14, codec 19/19, room 29, scoring 8), déterminisme + 0 `Math.random` dans la sim, 2 smoke tests dédiés (pont + échelle). Re-tuning des valeurs à l'échelle 1280×720 conseillé (chute, cratères, timings FSM).

### Gameplay-critique (à faire d'abord)

| # | Item | Effort | Risques / dépendances |
|---|---|---|---|
| 1 ✅ | **Vitesses projectiles** `ball/mus/bow/boltSpeed`+`grenTime`/`grenLob` (B7) | S | **FAIT.** 474/480/440/380 + `0.6` figés → params (`ballSpeed=470` aligné lab). `grenLob` exposé (dormant : le grenadier moteur vise toujours une cible). |
| 2 ✅ | **`slopeFx`** réglable, retirer `slopeK` (B5) | S | **FAIT.** `slopeFx=0.25` ; les 2 facteurs de pente soldat dé-figés ; `slopeK` (mort) retiré ; le `0.45` Intendant intact. |
| 3 ✅ | **Tour `towerDmg`/`towerBolts`** (B,A) | S | **FAIT.** `s.hp=0` → `s.hp-=towerDmg` (défaut 99 = one-shot, comportement inchangé) ; `floor(rnd()*4)` → `*towerBolts`. Baisser `towerDmg` fera survivre les soldats (revoir alors `pendingCata`). |
| 4 ✅ | **Variances de dégât** `bayo/gren/ball/sw/Var` (+ `mus/bowDmgVar` déjà là) (A) | S | **FAIT** boulet/grenade/épée + **`bayoDmgVar` actif** depuis le passage de la baïonnette en coup-par-coup (FSM #9). Toujours via `this.rnd()`. |
| 5 ✅ | **Déplacement par type** : 12 mults + helpers `spdMul/fallMul/jumpMul/climbStep` (B2) | M | **FAIT.** Tables `SPD/FALL/JUMP_MUL` + helpers méthodes ; `0.4/2.5/1.8` figés remplacés dans `stepSoldiers`. |
| 6 ✅ | **Modèle de chute linéaire** `fallHmin/fallHmax`, retirer `steepDown`/`fallProb` (B1) | M | **FAIT.** Proba linéaire `clamp((descAcc−fallHmin)/(fallHmax−fallHmin),0,1)` ; params morts retirés. Re-tuning à l'échelle 1280×720 conseillé. |
| 7 ✅ | **Rayons de cratère par munition** `ballCraterR`/`grenCraterR` (B10) | M | **FAIT.** Boulet `ballCraterR*pw`, grenade `grenCraterR` ; `craterR` reste défaut/outil. |
| 8 ✅ | **Cratères réalistes (saucer)** `carveCrater(...,vx,vy)` (B10) | L | **FAIT.** `vx/vy` propagés `explodeBall → carveCrater → world.carveCrater → Simulation.carveTerrain` (bol saucer elliptique + lèvre). **Branché sur la vitesse** : le duel (sans `vx/vy`) garde son bol rond — zéro impact sur le jeu de base. |
| 9 ✅ | **FSM d'action Wind→effet→Rec** (toutes armes) + `actTick` + tous `*Wind/*Rec/*Dur/*Dmg`, retirer `sDps/arRate/musReload/bowRate/effort/buildInterval` (B6) | L | **FAIT.** `actTick` + FSM pour baïonnette/mousquet/grenade/canon (soldats) et épée/arc/outils/construction (Intendant) ; 6 params morts retirés. Le canon garde le verrou `syncCannon` (arme engagée au début du pointage). ⚠️ **Changement de feel (baïonnette coup-par-coup) — à valider en playtest.** |
| 10 ✅ | **Saut balistique des soldats** `s.jvy/jdir` + `findPath(climb)` (B3, B3-bis) | L | **FAIT.** `findPath` gagne `climb` + arêtes d'échelle ; intégration du saut en tête de `stepSoldiers` + déclenchement après lecture du waypoint. |
| 11 ✅ | **Repositionnement** `repTime`/`fightT`/`pushT` (B4) | S–M | **FAIT** (variante : `repTime` par unité ∈ [1,4) seedé, cf. ci-dessous). Pas de dépendance FSM finalement : le moteur n'a pas de `s.act` soldat → on annule juste `s.path` + pousse `repPush`. |
| 12 ✅ | **`digH`** profondeur creuse/remblai + puits référencé au rebord (B9) | M | **FAIT.** `digH` propagé dans `world.dig/fill` ; creuse référencée au rebord stable `min(shoulderL,shoulderR)+w·digH` (anti-creuse-infinie). |
| 13 ✅ | **Canon PV/portée** `cataHp`/`cataRange` exposés (B8) | S | **FAIT.** `hp=8`→`cataHp` (défaut 5, plus fragile = valeur lab) ; `<240`→`cataRange`. |
| 14 ✅ | **Ingénieur + échelles** (type `engineer`, `ladders`, plan/reach/build, A* échelles) (B8) | L | **FAIT.** `ladders[]` + `planEngineer/buildPlan/navReach/hasEngineer/stepEngineer` ; échelle dans `findPath`/`craterStructures` ; segment `climb` + escalade Intendant ; spawn gaté ; snapshot + wire (`engineer`, états `jump/climb/build`) ; rendu (silhouette + marteau animé, échelles) ; audio modèle A (`engineerBuild` → composite). |

### Outillage éditeur (ensuite, non bloquant)

| # | Item | Effort | Notes |
|---|---|---|---|
| 15 ✅ | Rendu contrasté du boulet (traînée+reflet) (B11) | S | **FAIT** dans `BattlefieldView` : traînée chaude + corps sombre + reflet ; grenade sombre + mèche. Direction estimée par delta inter-frame (le fil ne porte pas la vitesse). |
| 16 ⊘ | Mode parcours (canon en observation) (B11) | M | **Non porté (intentionnel).** Outillage d'étude du lab ; le moteur n'a pas de `parcoursMode` et n'en a pas besoin pour jouer. |
| 17 ⊘ | Panneau de tuning live (`GROUPS`/`DESC`/`SPATIAL`, overlays portée/cône/échelle) (C) | L | **Non porté (intentionnel).** UI debug du lab (DOM + overlays canvas), entièrement séparable du gameplay ; pas un « port » moteur. |
| 18 ⊘ | `spawnDirt` biaisé downrange (`bias`) (B10) | S | **Non porté.** Effet visuel pur sans équivalent direct : le moteur émet la poussière via les émetteurs Phaser de `TvScene`, pas une fonction `spawnDirt`. Faible valeur, pas de hook propre. |

---

## E. Constantes encore EN DUR dans le lab (non exposées) — à décider

À chaque fois : valeur et emplacement lab. Décider si on les expose (params) ou on les fige au moteur.

| Constante | Valeur | Où (lab) | Note |
|---|---|---|---|
| Seuil d'accumulation de chute | `drop > 1.5` /frame | l.798, l.897 (moteur) | En-deçà, pas d'accumulation. Sensible à `dt`. |
| Bornes du facteur de pente | `clamp(..., 0.4, 1.4)` | l.777, l.793, l.880/891 (moteur) | Plancher/plafond de vitesse vs pente. |
| Rayon outil Intendant — creuse (digger) | `rr=11` | l.486 ; moteur `world.dig(...,11,...)` l.487 | |
| Rayon outil — remblai | `rr=13` | l.489 ; moteur `world.fill(...,13,...)` l.496 | |
| Rayon outil — aplanir | `rr=20` | l.493 ; moteur `world.flatten(...,20,...)` l.504 | |
| Rayon outil — basher horizontal | `reach=16` | l.481 ; moteur `bash(...,16,...)` l.482 | |
| Taille de horde | `3 + floor(rnd()*6)` (3–8) | l.430 ; moteur l.331 | |
| Multiplicateur de vitesse de horde | `×1.8` | l.792 ; moteur l.890 | |
| Rayon d'impact projectile (chair) | `9` px (soldat), `11`/`12` (Intendant) | l.630/631/637/638 ; moteur l.776/777/794/796 | Hitbox. |
| Angle de lancement du boulet | `atan2(−335, dir·335)` | l.742/704 ; moteur l.838 | ~45° fixe. |
| Récupération après chute | `min(2.2, descAcc·0.03)` | l.802 ; moteur l.903 | Durée d'immobilité (s). |
| Facteur dégât chute | `×0.1` (`fallDmg·descAcc·0.1`) | l.802 ; moteur l.903 | Échelle globale du dégât de chute. |
| `STROKE` (quantité d'un coup d'outil) | `0.32` | l.497 ; moteur l.69 | |
| Pente d'escalade du canon | `climbSlope·0.5` | l.776/741 ; moteur l.829/878 | Le canon grimpe 2× moins raide. |
| Handicap de pente du canon (`pw`) | `max(0.3, 1−|slope|·0.7)` | l.742 ; moteur l.828 | Réduit rayon de cratère + jitter. |

---

## Résumé (10 lignes max)

Le document compare le `C` du lab (source de vérité, v5) au `DEFAULT_PARAMS` du moteur (en retard) : tableau de ~110 clés avec état présent/absent/différent, et signale les 7 params MORTS (`slopeK/sDps/arRate/musReload/bowRate/effort/buildInterval`) à ne pas réintroduire — ils sont remplacés par le nouveau modèle. Il détaille 11 mécaniques à porter (chute linéaire `fallHmin/Hmax`, mults de déplacement par type, saut balistique, repositionnement, `slopeFx`, FSM Wind→effet→Rec, vitesses projectiles, ingénieur+échelles, `digH`, cratères saucer, rendu boulet), avec emplacement lab et action moteur précise. Il décrit l'éditeur (outillage séparable) et fournit une checklist priorisée (gameplay d'abord, outillage ensuite) avec effort S/M/L et dépendances, plus les constantes encore figées à arbitrer.

**Les 3 plus gros chantiers** : (1) **FSM d'action chronométrée** (toutes les armes passent en Wind→effet→Rec, retire 6 params morts, change le feel de la baïonnette) ; (2) **Ingénieur + échelles** (type `engineer`, `ladders`, plan/reach/build, intégration A*/cratères/navigation — entièrement absent du moteur) ; (3) **Saut balistique + A* `climb`** (couplés : sans `climb` par soldat dans `findPath`, le saut ne se planifie pas).
