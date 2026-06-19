# Champ de bataille vivant — Référence des règles (état courant, lab v22)

> Mise au net du **vocabulaire** et des **règles** par acteur. Complète `battlefield-vivant.md` (qui garde l'historique/journal). Cible **2.0.0**.

---

## 1. Glossaire (vocabulaire à figer)

| Terme | Définition |
|------|------------|
| **Camp** | Une des deux armées : **Bleu** (gauche) / **Rouge** (droite). Chaque camp = un joueur-artilleur + sa tour. |
| **Tour** | Bâtiment d'un camp : produit des soldats, possède des **PV**, tire à la **mousqueterie** depuis sa **meurtrière**. Détruite → **ruine**. |
| **Porte** | Ouverture au pied de la tour : point de **sortie/rentrée** des soldats (animation). |
| **Meurtrière** | Fente haute de la tour d'où part la mousqueterie de défense. |
| **Soldat** | Unité d'un camp. 3 types : **Mousquetaire**, **Grenadier**, **Canon de campagne**. |
| **Intendant** | 3ᵉ joueur neutre, avatar physique au centre. Ne tire jamais d'artillerie ; remodèle le terrain, bâtit, combat à l'épée/arc. |
| **Envahisseur / Défenseur** | Rôles de manche : **vainqueur précédent = envahisseur** (hostile à l'Intendant) ; **perdant = défenseur** (en paix). Manche 1 = **trêve**. |
| **Ouvrage** | Construction de l'Intendant : **pont** ou **escalier** (planches posées, façon Lemmings). |
| **Cratère** | Trou laissé par un impact d'artillerie (ou l'outil cratère). |
| **Crête / ligne de crête** | Profil du sol (heightfield). |
| **Terrain frais** | Sol récemment remué (cratère, creuse, remblai, aplanir) : teinte claire temporaire + particules. |
| **PV** | Points de vie (tours & Intendant, **même échelle**). |
| **Ressources** | Monnaie de l'Intendant, **par couleur** (🔵/🔴), gagnée aux morts de soldats, dépensée pour bâtir. |
| **Gloire / manches** | Score méta (podium à 3) — distinct des ressources. |
| **Déserteur** | Soldat qui abandonne (bloqué trop longtemps ou tour détruite) : **drapeau blanc**, fuit, n'est plus pris pour cible. |
| **Horde** | Vague de soldats de fin de manche qui charge la ruine. |

---

## 2. Le CAMP / la TOUR

- **Deux camps** symétriques (Bleu gauche, Rouge droite).
- **Production** : émet des soldats par **paires synchronisées** (manuel ou cadence auto). **S'arrête** dès qu'une tour est détruite (fin de manche).
- **PV de tour** = `maxHp`. Endommagée par **boulet de canon** (−1) et **grenade** (−0,34). À 0 → **ruine**.
- **Défense (mousqueterie)** : si un intrus (**Intendant** OU **soldat ennemi**) entre dans la **zone d'alerte**, une flèche s'**encoche** (menace) ; plus près (**zone de tir**), **volée de 1 à 4 balles** (nombre **seedé**), canon qui dépasse de la meurtrière + gerbe de feu.
  - Balle de tour : **tue un soldat ennemi en 1 coup** (+ déclenche un **canon de campagne** pour le camp du tué) ; sur l'Intendant → **draine 1 ressource** (pas de PV).
- **Cible** : l'intrus le plus proche dans la zone (Intendant prioritaire à distance égale).

---

## 3. Les SOLDATS

### 3.1 Tableau des types

| Type | Apparition | Arme | Portée | Particularité |
|------|-----------|------|--------|---------------|
| **Mousquetaire** | défaut | **baïonnette** (contact) + **mousquet** (1 balle, longue recharge, **immobile**, **ligne de vue** requise) | `engage` / `musRange` | unité de ligne ; **visée imparfaite** : `musAcc` de chances que le coup soit *ajusté* (faible dispersion `musSpread`), sinon il part **large** (`musMissSpread`) ; **dégâts seedés ±50 %** autour de `musDmg` (`musDmgVar`) |
| **Grenadier** | ~1/10 (seedé) | **grenade** lobée (tir **indirect**, pas de LOS) → **mini-cratère + éclat** | `arRange` | délogeur / anti-couvert |
| **Canon de campagne** | quand sa tour a perdu un soldat sous le feu adverse | **boulet** sur la **tour adverse** uniquement | ~240 px | **engin à roue** : **terrain seul** (escalade impossible), lent, **ne déserte jamais** ; s'il est **coincé** il **tire sur place** ; **puissance ∝ planéité** du sol (handicap de terrain réduit le boulet, ne le rend pas injouable) ; **×2.5** aux dégâts de chute ; dispersion **seedée ∝ pente**, aucun vent |

### 3.2 Déplacement (pathfinder)

- **A\*** sur un graphe de **surfaces** (sol + planches d'ouvrage) jusqu'à la **tour adverse** ; **emprunte** escaliers/ponts (embarque par la base), **revient sur ses pas**, **recalcule** si le terrain/les ouvrages changent.
- **Désencombrement** : le coût d'un itinéraire est **majoré par la densité locale de soldats** (`pathCongestion`, tous camps + horde confondus — l'encombrement est physique) **et** brouillé par un **jitter seedé propre à chaque soldat** (`pathJitter`). Une horde s'**éventaille** sur les routes alternatives au lieu de s'empiler au même goulot. Coûts strictement positifs → **la faisabilité ne change jamais**, seul le tracé choisi change (le test de traversée reste un A\* pur).
- **Sans chemin** → avance quand même en **glouton** ; se bloque/déserte à un **vrai mur**.
- **Chute** : dégâts ∝ **hauteur réellement chutée** (pente raide **ou** saut d'un ouvrage, traités pareil) + **récupération au sol** (immobile, ∝ hauteur). Pas de parachute.
- **Espacement** : en colonne, **entre unités du même type et même camp** seulement (un mousquetaire traverse un grenadier).

### 3.3 États de fin de vie

- **Déserteur** : bloqué > `desertT`, **ou sa tour est détruite** → drapeau blanc, **rejoint sa tour** (ou **fuit tous azimuts** si elle est détruite, seedé), dessiné **au second plan**, **plus ciblé** par personne.
- **Mort au combat** → **+1 ressource** de sa couleur pour l'Intendant. **Tué par l'Intendant → +6** (1 + bonus 5). **Chute/suicide/tir allié → 0 ressource.**
- **Fin de manche (tour détruite)** : **perdants désertent**, **gagnants chargent la ruine** et s'y **rassemblent en désordre** (encore mortels) ; plus d'espacement.

---

## 4. L'INTENDANT

### 4.1 Vie & vulnérabilité

- **PV = PV des tours** (`maxHp`). **Sensible uniquement à l'artillerie** : un **boulet** lui enlève des PV (peut le **tuer**).
- **Tirs de soldats** (mousquet, grenade, baïonnette, balle de tour) → **drainent 1 ressource** de la couleur du tir (**plancher 0**), **jamais de PV, jamais de mort**.
- **Planeur automatique** : se déploie dès que le saut devient une chute → **pas de dégâts de chute**.
- **Apparition** : descend **du ciel, au centre** (1ʳᵉ fois) ; **au sommet de la colline** ensuite.
- **Immobile ≠ figé** : même injouable (trêve / fin de manche / occupé par une action), il reste **soumis à la gravité et au planeur automatique** (il tombe/atterrit normalement).
- **Avatar par biome** : **Mascotte** sur le biome **Orage**, **Robe** sinon.

### 4.2 Combat (auto, aligné)

- **Attaque automatique** uniquement l'**envahisseur** (jamais le défenseur, jamais en trêve, jamais un déserteur).
- **Épée** si un ennemi est à **portée d'épée** (zone d'effet devant, `swDmg`) ; sinon **arc** si cible **à portée ET en vue** (`bowDmg`, arc orienté). Combat suspendu si une autre action est en cours.
- **Arc à visée imparfaite** : comme le mousquet, `bowAcc` de chances d'un tir *ajusté* (`bowSpread`), sinon **large** (`bowMissSpread`) ; **dégâts seedés** autour de `bowDmg` (`bowDmgVar`). L'angle **affiché** reste la vraie visée (rendu) ; seule la flèche dévie.

### 4.3 Économie

- **Ressources par couleur** 🔵/🔴, gagnées aux **morts de soldats** (cf. 3.3).
- **Construction** : **5 🔵 + 5 🔴** par ouvrage (pont OU escalier), payé au départ. (Mode **illimité** au lab.)

### 4.4 Actions (UNE seule à la fois)

| Action | Touche | Notes |
|--------|--------|-------|
| Déplacer | ←→ / A D | **pénalisé par la pente** (plus de montée horizontale instantanée) ; **escalade** lente si trop raide |
| Sauter | ↑ / Espace | dirigeable en l'air ; **planeur auto** à la descente |
| Descendre d'un ouvrage | ↓ | |
| **Creuser** | J + direction | **oneshot** (pré-effort → coup → post-effort) ; maintenir = répète |
| **Remblayer** | H + direction | oneshot (inverse de creuser) |
| **Aplanir** | G | oneshot ; **brosse locale** (un peu large) → transforme la zone en **pente droite** entre ses 2 bords (continuité conservée) ; peut rendre un chemin praticable |
| **Escalier** | K | ouvrage Lemmings + piliers de soutien ; coûte 5+5 |
| **Pont** | L | ouvrage Lemmings + barres de consolidation ; coûte 5+5 |

---

## 4bis. Plans de profondeur (z-order, du fond vers l'avant)

| # | Plan | Objets |
|---|------|--------|
| 1 | Ciel | dégradé de fond |
| 2 | Terrain | sol (crête), **terrain frais** (teinte), **particules de terre** |
| 3 | Ouvrages | planches **pont/escalier**, **barres de consolidation** |
| 4 | **Arrière-plan** (derrière les tours) | **déserteurs** + **moitié de la horde** (`bg`) — estompés & réduits ; les `bg` sont *derrière la tour* |
| 5 | Tours | corps, meurtrière, **canon** de défense, ruine, barre de PV |
| 6 | **Premier plan** | reste de la **horde**, **soldats** actifs (mousquetaires/grenadiers/canons) |
| 7 | Intendant | avatar + planeur + arme/outil *(à intégrer : **devant** la manche à air)* |
| 8 | Projectiles | balles, carreaux, flèches, boulets, grenades |
| 9 | UI/Debug | zones de tir des tours, debug chemins |

> Règle : les unités **« quittent le terrain »** (déserteurs, demi-horde de fond) passent au **plan arrière** (estompé + réduit + derrière les tours) → effet de profondeur. Tout le reste est au premier plan.

## 5. Matrice de dégâts (qui blesse qui)

| Source ↓ \ Cible → | Soldat | Tour | Intendant |
|---|---|---|---|
| **Baïonnette / mousquet / grenade** (soldat) | PV soldat | grenade : PV tour | **ressource** (pas de PV) |
| **Balle de meurtrière** (tour) | **1 coup = mort** | — | **ressource** |
| **Boulet** (canon de campagne) = *artillerie* | (collatéral terrain) | **PV tour** | **PV Intendant** (peut tuer) |
| **Épée / arc** (Intendant) | PV soldat (+ butin) | — | — |
| **Chute** | PV ∝ hauteur | — | rien (planeur) |

→ **Règle mentale** : *l'**artillerie** (boulets) blesse les **structures et l'Intendant** ; le **combat de soldats** tue les **soldats** et **coûte des ressources** à l'Intendant.*

---

## 6. Boucle de manche (v23 — décidé)

Le jeu privilégie le **2 joueurs** ; l'Intendant est un **extra**. Une manche se termine par la **destruction d'une tour** → le camp adverse marque un **point de victoire**. Avant la transition vers la manche suivante :
1. Le **résultat de l'Intendant est calculé et animé** ; il devient **injouable** et passe **en trêve** ; les **soldats vaincus désertent** immédiatement.
2. **Défi réussi** (champ franchissable, via pathfinder) → **+1** à l'Intendant : la **horde** (**3 à 8** soldats, sortie chaotique, **moitié au plan arrière** derrière la tour pour la profondeur) ET les **vainqueurs** se précipitent autour de la ruine.
3. **Défi échoué** → **seuls les vainqueurs** chargent (ils mourront probablement en chemin), **pas de horde**.
4. **Manche suivante** : un **Intendant est déjà en place au sommet** de la nouvelle colline (pas d'entrée du ciel — réservée à la **première** apparition). *Z-order : Intendant **devant** la manche à air.* **Alignement** : le **vainqueur précédent devient l'envahisseur** ; **manche 1 = trêve**.

**Déconnexion** (mêmes seuils que P1/P2) :
- **< 10 s** : l'Intendant **reste dans son mode courant** (trêve / contre l'envahisseur), ses **actions automatiques continuent**.
- **> 10 s** : il **reste sur le champ** mais passe **en trêve + injouable**, les **soldats désertent** ; on lui **calcule ses points de fin de manche** ; **pas de feature 3-joueurs à la manche suivante** (pas d'Intendant → pas de soldats). *(Dans le lab : bouton « Présent/Absent ».)*

---

## 6bis. Intégration multijoueur (places, déconnexions, victoire)

> **Controller P3** : maquette dans `./design/controller-p3.html` — schéma **joystick (déplacer + viser) + rangée d'outils + 1 gros bouton ACTION** (à la FIRE de P1/P2) + bouton Sauter ; HUD : PV, **ressources 🔵/🔴**, **alignement** (envahisseur/trêve), manches, vent purement indicatif. Attaque épée/arc **automatique**. Cohérent avec l'overlay plein écran thémé de `ControllerScene.js`.
>
> **Implémenté (intégration v2.0, lots 5-7)** : `IntendantScene.js` (pad P3), siège Intendant parallèle dans `server/Room.js` (slot 2), toggle lobby « Bataille vivante », rendu TV (`BattlefieldView.js`). **Mode réseau uniquement — pas d'Intendant en local** (`LocalScene` reste un duel 2 joueurs).

- **Places** : le **3ᵉ connecté = Intendant (P3)** *(seulement si le config owner a activé « Bataille vivante » ; sinon le 3ᵉ reste spectateur en file)*. Un **4ᵉ** joueur prend la place libre par **ordre de priorité P1 → P2 → P3**. **Pas de glissement** en cas de déconnexion : chacun **conserve sa place**.
- **Victoire de partie (3 entiers, égalité → P3)** : on classe sur **une seule échelle entière** les **points de victoire** de P1 et P2 (manches gagnées) et les **traversées réussies** de P3. **Plus haut gagne ; à égalité, P3 l'emporte** (l'outsider est couronné). → **DÉCISION** : ce « égalité → P3 » **supprime le besoin** d'un demi-point, d'une monnaie de gloire séparée, d'un plancher MVP ou d'une extrapolation (cf. `vivant.md §6`, désormais caduc sur ces points). Réf. code : `src/sim/scoring.js`.
- **Succès du défi de l'Intendant (testé pour de vrai)** : à la fin de manche, la **horde tente de traverser**. Le défi est **réussi seulement si au moins un soldat de la horde atteint la zone de la ruine** ; sinon **échec** (le pathfinder ne suffit pas — falaises, blocages, morts comptent). Chaque succès = **+1 traversée** au compteur de P3.
- **Déconnexion** (seuil **> 10 s**, même constante que P1/P2) :
  - **2 joueurs** : un joueur déco → l'**autre est déclaré vainqueur immédiatement**.
  - **3 joueurs, P3 déco** : l'**Intendant reste inactif**, le **mode 3-joueurs n'est pas renouvelé** (manche suivante sans Intendant ni soldats).
  - **3 joueurs, P1 ou P2 déco** (sans remplaçant en file) : on **détruit immédiatement la tour** du déconnecté → **fin de partie** (l'autre duelliste remporte le duel ; **P3 est classé** sur ses traversées, **égalité → P3**). *Plus de demi-point : inutile avec la règle d'égalité.*
  - **< 10 s** : le joueur reste **présent** dans son **mode courant**, ses **actions automatiques continuent** ; ses **commandes manuelles sont gelées** le temps de la grâce. La dormance (trêve + désertion) ne s'applique qu'**à la libération** du siège (> 10 s).

## 7. Simplifications & rapprochements

> **Décidé (v23)** : #1 nommage **OK** (« Canon de campagne », Ressources≠Gloire, ouvrage) · #2 deux échelles **OK** · #3 brique « unité à distance » **OK** · #4 **Aplanir conservé** mais retravaillé en **mise en pente droite** (cf. §4) · #5 **fin de manche = destruction de tour** + scoring Intendant calculé/animé à la transition (cf. §6) · #6 **absence → désertion** (repli supprimé) + déconnexion (cf. §6). Reste : #7 unifier repli/désertion (fait), #8 boussole 3 verbes.

1. **Nommage à figer** (incohérences actuelles) :
   - « catapulte » ↔ « petit canon à roulettes » → choisir **un** terme (proposé : **Canon de campagne**).
   - « ressources » vs « points de construction » → **Ressources** (🔵/🔴) ; garder **Gloire** pour le score méta. Ne pas confondre les deux.
   - « ouvrage » pour pont/escalier (et pas « structure/construction » au hasard).

2. **Deux échelles de dégâts, pas plus** : tout rentre dans **Combat** (PV soldat, petite échelle) ou **Artillerie** (PV tour/Intendant, grande échelle). L'Intendant fait le pont : *artillerie → ses PV ; combat → ses ressources*. ✅ déjà le cas — à **garder explicite** dans les libellés.

3. **Une seule brique « unité à distance »** : meurtrière, mousquet, grenade, boulet, arc-Intendant font tous *« vise l'ennemi le plus proche devant, à portée, (en vue), cadence X, projectile Y »*. Les **paramétrer comme variations d'un même comportement** (range, rate, projectile, LOS oui/non) — clarté + moins de code dupliqué.

4. **Terraform : 3 verbes, peut-être 1 de trop.** Creuser / Remblayer sont un **axe inverse** (logique). **Aplanir** recoupe en partie « creuser une bosse + remblayer un creux ». Candidat à **fusionner** (ex. aplanir = comportement auto quand on creuse/remblaie sans direction) ou à **couper** si peu utilisé — à décider après tests. Objectif : **peu de verbes** pour un 3ᵉ joueur d'appoint.

5. **Séparer nettement « fin de manche » et « score Intendant ».** La destruction d'une tour **résout le duel** (fin de manche). La **traversée** est le **scoring parallèle** de l'Intendant — ce n'est pas une fin de manche. Le bouton lab actuel mélange les deux ; en jeu, dissocier : *duel résolu* vs *l'Intendant a marqué*.

6. **Chute unifiée par hauteur** ✅ (fait) : pente raide et saut d'ouvrage = mêmes dégâts à hauteur égale. L'Intendant a un **planeur** (l'annule) ; les soldats non. Modèle mental cohérent.

7. **Rapprochement « déserteur » ↔ « repli »** : aujourd'hui *repli* (Intendant absent) et *désertion* (bloqué/tour détruite) sont deux comportements proches (le soldat quitte le champ). On pourrait les **unifier** sous un seul état « quitte le terrain » avec deux déclencheurs.

8. **Le rôle de l'Intendant = un trio lisible** : **(re)modeler le terrain**, **bâtir des passages**, **se défendre**. Tout le reste (économie, alignement) découle de ça. Garder ce **pitch en 3 verbes** comme boussole anti-surcharge.
