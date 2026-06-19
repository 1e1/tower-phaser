# Champ de bataille vivant — doc de design

> **Statut** : brouillon de design (défrichage validé en discussion).
> **Cible** : version **2.0.0**. À migrer dans `docs-src/` au moment de l'implémentation.
> **Hors périmètre actuel** : ce doc vit dans `./design/` pour ne pas se mêler aux commits en cours.

---

## 1. Vision

Ajouter une **couche de monde vivant** par-dessus le duel d'artillerie existant :

- des **soldats** sortent des tours et marchent en continu le long de la crête vers la tour adverse, avec résolution d'affrontement quand deux armées se rencontrent ;
- un **3ᵉ joueur, l'Intendant du monde**, ne tire jamais : il sculpte l'arène (terrain, eau, lave), la peuple (bâtiments-décor, animaux) et poursuit un **objectif découplé** du duel ;
- les trois joueurs sont départagés à la fin sur une **monnaie de gloire unique**, avec un **podium à 3** où l'Intendant peut être couronné **MVP** — sans jamais décider qui gagne le duel.

Motivation produit : occuper un joueur qui patiente (file d'attente / prochain challenger) **sans déséquilibrer** la partie à deux.

---

## 2. Décisions verrouillées

| Sujet | Décision |
|-------|----------|
| **Soldats** | Sortent des tours, marchent **en continu** (temps réel) le long de la crête, s'affrontent à la rencontre. |
| **Boucle d'artillerie** | Reste **au tour par tour** (AIMING → FIRING → RESOLVING inchangé). |
| **Monde** | **Vit en continu** pendant la visée : soldats, lave/eau et animaux avancent même quand le joueur actif vise → pression temporelle sans refonte de la boucle. |
| **3ᵉ joueur** | **Intendant du monde** : terraformage central, fluides (eau/lave), bâtiments, animaux. Jamais de dégât direct. |
| **Neutralité** | Garantie par (a) **objectif découplé** du résultat du duel et (b) **action limitée au centre** + jamais ciblée. |
| **Scoring** | Monnaie de **gloire** unique aux 3 rôles. **Podium à 3.** L'Intendant **peut gagner la partie** (vrai MVP à 3). |

---

## 3. Les soldats

- **Spawn** : depuis la base/tour, à `(tower.x, tower.groundY)`.
- **Marche** : `x += vitesse * dt` vers l'ennemi ; `y = heightAt(x)` → suit la crête gratuitement. La pente module la vitesse (montée lente, descente rapide).
- **Affrontement** : à la rencontre de deux soldats adverses, duel par épuisement de PV ; le survivant reprend sa marche. Réutiliser le pattern d'échantillonnage de trajectoire déjà utilisé pour boucliers/windsock.
- **Dégât collatéral** : un obus qui passe peut faucher des soldats (même échantillonnage). La lave les tue (cf. §5).
- **Arrivée** : un soldat qui atteint la tour adverse inflige un petit dégât **et rapporte de la gloire à son propriétaire** (2ᵉ source de gloire, cf. §6).
- **Unités à la poudre (v14 — conversion RP assumée)** : puisque les tours ont des canons, les armées passent à la poudre.
  - **Mousquetaire** (base) : **baïonnette** au contact, sinon **mousquet** — 1 balle puissante, **longue recharge** qui l'**immobilise** (ligne de feu) ; tir direct, requiert la **ligne de vue**.
  - **Grenadier** (~1/10, seedé) : **lobe une grenade** (tir **indirect**, par-dessus le relief) → **mini-cratère + éclat** (~10% canon) sur soldats/Intendant.
  - **Tours** : **mousqueterie** (volée **1-4** balles, seedée) — 1 balle = 1 mort soldat, −2 PV Intendant ; touche toujours (no-go zone).
  - **Petit canon à roulettes** = l'unité d'escalade (cf. catapulte) : tire des **boulets** (puissance canon, gros cratère) sur la tour adverse.
  - **Intendant** : reste **épée + arc** — *révolté indépendant*, d'aucune armée (contraste médiéval voulu).
- **Déserteur (v13→v17)** : un soldat **bloqué trop longtemps** (ou dont la **tour est détruite**) **déserte** — **drapeau blanc**, plus pris pour cible, **dessiné au second plan**. Il **rejoint sa tour d'origine** ; si elle est **détruite**, il **fuit tous azimuts** (direction seedée par soldat).
- **Fin de manche par destruction de tour (v19)** : tour détruite → **plus de production** ; les **perdants désertent** (tous azimuts), les **gagnants chargent la ruine** et s'y empilent (**encore mortels**).
- **Chute (v19)** : à l'atterrissage, **temps de récupération au sol ∝ hauteur de chute** (animation « à terre » + poussière) ; le **canon encaisse plus** de dégâts de chute (×2.5).
- **Catapulte d'escalade (v13)** : quand une **tour tue un soldat adverse**, le **prochain soldat du camp du tué** est une **catapulte / petit canon à roulettes** — lente, mais qui **tire sur la tour adverse** des projectiles de **puissance canon** (cratère). Valve anti-déséquilibre : le camp assiégé obtient de quoi riposter. *Prototype lab : cadence fixe. En jeu : ne tire que quand la **tour est à portée** ET quand le **joueur arme réellement un tir** (anti-hack : rechargée seulement quand la tour a vraiment tiré).*
- **Perméabilité des constructions (v9)** : les soldats suivent le **terrain par défaut** ; une structure (pont/escalier) ne sert que de **pont/rampe** quand le terrain est un **mur** (montée raide) ou un **trou** — elle ne **bloque jamais** le passage (le soldat peut « passer à travers » / descendre pour rejoindre le terrain).
- **Pathfinder (v18 — vrai routage)** : graphe de navigation = **surfaces praticables** (sol + chaque planche d'ouvrage au-dessus du sol) ; **Dijkstra** du soldat vers la tour adverse (coût = distance + pénalité de chute). Le soldat **suit les waypoints** : il **emprunte escaliers/ponts** (embarque par la base, monte/descend), **contourne** et **revient sur ses pas** si besoin, et **déserte** si aucun chemin n'existe. **Replanification** quand le terrain ou les ouvrages changent (cratères, constructions — via `navVer`). Les planches **enterrées** (sous la surface) ne sont jamais des surfaces valides (le build l'interdit déjà). *Prouvé par test auto : franchissement d'un gouffre via un pont.* **Sans chemin → glouton (v22)** : les soldats avancent quand même vers le but, et ne se bloquent/désertent qu'à un vrai mur. **Désencombrement (v23)** : le coût d'arête est **majoré par la densité locale de soldats** (champ d'occupation par colonne du graphe, tous camps + horde — l'encombrement est physique, pas une question de camp ; chaque corps déborde à demi-poids sur ses colonnes voisines pour qu'un goulot se lise comme une crête) **et** brouillé par un **jitter seedé propre à chaque soldat** (`hash(jseed, colonne)`). Une horde **s'éventaille** sur les routes alternatives au lieu de toutes faire la queue au même pont. Les deux termes sont **strictement positifs** → la **faisabilité ne change jamais** (le test de traversée passe sans ces options : A\* pur), seul le **tracé** choisi change.
- **Économie — pas de butin hors combat (v22)** : mort par **chute/suicide** ou **tir allié** = **0 ressource** (seules les morts par tir ennemi/Intendant comptent).
- **Chute cohérente (v22)** : dégâts ∝ **hauteur chutée** (pente raide ou saut d'un pont/escalier, traités pareil). *Pas de parachute depuis les ouvrages — trop exploitable (un pont haut rendrait toute descente gratuite).*
- **Tir imparfait (v23)** : mousquet **et** arc de l'Intendant ont une **probabilité de visée** (`musAcc` / `bowAcc`) — coup *ajusté* (faible dispersion angulaire) ou *manqué* (dispersion large) — et des **dégâts seedés** autour de la valeur nominale (mousquet **±50 %**, arc **±~17 %**). Tout est tiré du générateur seedé (déterminisme préservé). Côté arc, l'**angle affiché** reste la vraie visée (rendu cohérent) ; seul le projectile dévie.

> **Gating par l'Intendant** (décision révisée — prototypée au lab) : les soldats sont **le domaine de l'Intendant**. Sans lui (déconnexion > 10 s, défait, pas encore connecté), **les tours cessent d'émettre** et **les soldats en jeu font demi-tour pour rentrer dans leur tour d'origine** (puis se retirent). Le 3ᵉ joueur **est** le monde vivant : pas d'Intendant → retour au duel d'artillerie pur. (Annule la formulation initiale « les soldats marchent sans Intendant ».)
>
> **Émission synchronisée** : à chaque vague, **chaque tour émet un soldat en même temps**. Cadence configurable (auto à fréquence donnée, ou manuelle).

### 3.1 Modèle de déplacement (valeurs à tuner au lab)
Position = abscisse `x` (le camp donne le sens, +x ou −x) ; `y = heightAt(x)` colle le soldat à la roche.

- **Vitesse de base** `v0` (px/s).
- **Pente** : on lit `heightAt` un peu devant → pente signée. **Montée → ralentit** (facteur < 1, avec plancher pour ne jamais s'arrêter). **Descente → accélère** (facteur > 1, avec plafond).
- **Dévalage en descente raide** (optionnel, activable) : au-delà d'un seuil de pente, le soldat dévale — vitesse débridée, perte de contrôle, petit étourdissement à l'arrivée. Dramatique près d'un cratère ou de la lave ; synergie avec les bosses centrales des arènes variables.
- **Blocage** (4 cas) :
  - **Ennemi à portée d'engagement devant** → stop + combat, jamais de traversée.
  - **Allié devant** → pas de dépassement, on cale sa vitesse sur lui → **colonnes de marche + ligne de front** où les renforts alimentent le combat.
  - **Obstacle Intendant** (rocher/mur) ou **marche de terrain trop haute** (paroi de cratère) → blocage ; trop raide en descente → dévalage.
  - **Eau** → ralentissement (gué) ; **lave** → mort.
- **Combat** : dps continu jusqu'à la mort d'un des deux ; le survivant (blessé) reprend sa marche.
- **Cas limite cratères** : la surface devient non-fonctionnelle près des cratères (plusieurs `y` pour un même `x`). Règle proposée : le soldat marche sur la surface solide **supérieure** ; un cratère infranchissable l'arrête ou le canalise. À trancher au lab.
- **Suivi de crête naturel (v4)** : la position verticale est calée sur la surface **la plus proche de la position courante** (et atteignable), pas sur la plus haute — évite les téléportations verticales quand plusieurs chemins (terrain + structures) se superposent.
- **Porte (v4)** : à l'émission comme au repli, le soldat **apparaît / disparaît dans le cadre de la porte** (dessin détouré), transition rapide + montée en vitesse progressive à la sortie.

---

### 3.2 Tours défensives — porte & meurtrières (zone protégée)
Design réel des tours réutilisé (corps 56×96, appareil de pierre, merlons, canon, moyeu de poudre — cf. `geometry.js` / `objects/Tower.js`), enrichi de :
- **Porte** au pied, côté champ : **point de sortie des soldats**.
- **Meurtrière** (une seule, **haute** — la basse nuisait à l'esthétique) avec une **défense à deux paliers** :
  1. **Zone d'alerte** : si l'Intendant **ou un soldat ennemi** approche, une flèche s'**encoche** (entrée/sortie **animée**), pointée vers l'intrus.
  2. **Zone de tir** (plus proche) : **volée de 1 à 4 flèches** (nombre **seedé**, pas de vrai random). **1 flèche = 1 mort** pour un soldat ; **−1 PV** pour l'Intendant. Les flèches **meurent au contact du sol**.
- **But** : empêcher l'Intendant d'**interagir avec le terrain immédiat des tours et les bords du champ** (no-go zone), et défendre contre les soldats adverses au contact.

---

## 4. L'Intendant du monde — palette triée par risque d'équilibre

> **Forme retenue (révisée au lab) : un avatar physique sur le terrain, façon *Lemmings*** — pas un curseur-dieu abstrait. Il se déplace gauche/droite à vitesse bornée (façon joystick), **saute**, **creuse**, **bâtit un escalier**, **bâtit un pont**, **plane** (pour ne pas mourir d'une chute). Il subit la gravité et la chute (atterrir trop vite sans planer le blesse).
>
> **Combat de l'Intendant** : il **remporte tout corps-à-corps tant qu'il maintient une attaque** ; sans attaque, un soldat au contact l'entame. À 0 PV → considéré « absent » (cf. gating §3).
>
> Les actes de terraformage ci-dessous sont donc réalisés **par l'avatar, là où il se trouve** (creuser sous ses pieds, poser un pont devant lui…), ce qui resserre le garde-fou « action au centre » : il agit physiquement, pas à distance.
>
> **Précisions prototypées au lab (v2) :**
> - **Pentes raides (révisé v3)** : les **soldats ne grimpent pas** une montée trop raide (infranchissable → ils s'accumulent) ; en **descente** trop raide ils **chutent et perdent des PV** (probabilité + dégâts/s réglables). Seul l'**Intendant escalade** (montée verticale lente).
> - **Creuser** = action **directionnelle et lente** (bâche le terrain devant, façon *basher* Lemmings).
> - **Escalier / pont** = **structures posées** (planches/marches superposées), **sans remplissage du terrain** — vraiment façon Lemmings. Les unités marchent dessus. **Marches fines** (faible hauteur) → **franchissables sans difficulté** par les soldats ; **contremarches** (piliers) entre marches pour une pente continue ; **2 piliers de soutien** au milieu de la plus haute marche (verticaux ou à 45° selon raccord au sol, comme les ponts). L'Intendant **ne peut pas s'enterrer** en remblayant (maintenu à la surface).
> - **Armes — auto-switch (v9)** : **épée** si un ennemi est à **portée d'épée** (zone d'effet devant) ; sinon **arc** si une cible est **à portée ET en vue** (ligne de vue bloquée par le relief). L'arc s'**oriente vers la cible** (sinon position par défaut). Plus de sélection manuelle.
> - **Combat aligné RP (décidé)** : le **vainqueur de la manche précédente = envahisseur**, **hostile** à l'Intendant (ses soldats l'attaquent) ; le **perdant = défenseur**, **en paix**. L'Intendant **n'attaque que l'envahisseur** et **protège le défenseur**. **Manche 1 = trêve** (ni combat ni agression — il terraforme / sauve les animaux). C'est une **mécanique de come-back thématisée** (il aide l'underdog) — [[gamification-philosophy]].
  - *Économie (v15→v19)* : **toute mort de soldat** → **+1 ressource de sa couleur** ; **kill par l'Intendant** → **+6** (1 + bonus 5). Surplus dans la couleur de l'envahisseur → déséquilibre qui l'**incite à aider l'autre camp**. **Coût de construction (v19) : 5 bleu + 5 rouge** par ouvrage (pont OU escalier), payé au départ. Armes Intendant **paramétrables** (dégât épée/arc).
  - *Canon de campagne (v15)* : **dispersion seedée ∝ pente** du sol, **aucune notion de vent**. **Boulet (canon) et grenade endommagent les tours** (les tours ont des PV ; détruite → ruine). En jeu, le canon **tire en synchro du tir réel de la tour** (pas dès l'armement) — *intégration, proto lab = cadence fixe*.
- **PV de l'Intendant = PV des tours (révisé v19)** ; il est **sensible uniquement à l'artillerie** (boulet de canon → PV, peut le tuer). Les **tirs de soldats** (mousquet, grenade, contact, carreau de tour) **drainent ses ressources** de la couleur du tir (plancher 0) **sans PV ni mort**. Chute = petits dégâts environnementaux.
- **Sensible aux boulets + corps-bonus (décidé)** : un boulet peut le faucher ; **à terre (mort/déconnexion), son corps reste** et le **premier duelliste qui le canonne gagne un bonus** (façon manche à air / windsock), puis il **réapparaît** (descente en planeur au centre) après un délai. *Intégration jeu (nécessite l'artillerie) — hors lab.*
- **Apparition à la connexion** : matérialisation au centre (descente en planeur / fondu).
> - **Aplanir (v20→v21)** : action `G`, **brosse locale** (même zone que creuser/remblayer) qui **égalise le terrain vers la moyenne locale** (arase bosses et comble creux).
> - **Planeur automatique (v22)** : il se **déploie tout seul dès que le saut devient une chute** (comme l'épée/l'arc sont auto) → l'atterrissage est toujours doux, **plus de notion de dégâts de chute** pour l'Intendant. Sa **vitesse au sol est pénalisée par la pente**.
> - **Outils oneshot (v22)** : creuser/remblayer/aplanir sont des **actions oneshot** avec un **petit temps d'effort avant et après** (`effort`) ; maintenir la touche **répète** (effort inclus à chaque coup).
> - **Apparition (v20)** : il **descend du ciel au centre** à sa première venue / reconnexion.
> - **Creuser** et **remblayer** (action inverse) dans les **8 directions** (au joystick dans le jeu réel) ; **descendre** d'un pont/escalier en poussant vers le bas ; **contrôle aérien** (déplacement dirigeable pendant saut/plané).
> - **Couleur de camp de l'Intendant** : il a sa propre couleur (distincte des camps bleu/rouge) qui teinte **ses outils, son planeur et ses flèches** (le cyan a été abandonné).
> - **Creuser / remblayer sans direction** : par défaut, **creuser → vers le bas**, **remblayer → vers le haut** (une direction explicite oriente l'outil sur 8 axes).
> - **Économie de construction (v7→v11)** : escalier et pont coûtent des **points de construction par camp** — tuer un soldat donne 1 point de **sa couleur**, et chaque segment coûte **1 bleu + 1 rouge**. (Garde-fou de neutralité : pour bâtir il faut avoir frappé **les deux armées**.) Mode **points illimités** dans le lab.
> - **Une seule action à la fois (v11)** : planer ⊅ attaquer/creuser/bâtir ; creuser/remblayer ⊅ attaquer/bâtir ; bâtir ⊅ attaquer/creuser.
> - **Outil cratère** (lab uniquement) : carve des cratères au clic pour visualiser l'effet des dégâts d'obus sur le pathing.

### Santé de l'Intendant — feedback diégétique (validé)
> **Contrainte** : PV de tour **plafonnés à 3**, et PV Intendant = PV tour ; **sensible au boulet uniquement** (les tirs de soldats drainent les *ressources*, cf. ci-dessus).

- **Canal principal — le cortège** : **une entité vivante par PV restant**, une s'éteint à chaque boulet encaissé. C'est le **seul canal lisible et chiffrable à distance TV**, donc le porteur d'information. **Skin par biome** (comme l'avatar Robe/Mascotte, cf. §3.3) :
  - **Prairie** → **oiseaux** ;
  - **Désert / Vulcano** → **fées de feu** ;
  - **Toundra** → **fées de glace** ;
  - **Orage** → **chauves-souris**.
  - **Mouvement** : oiseaux et chauves-souris décrivent une **boucle continue (en 8) ancrée sur les coordonnées de l'Intendant** (elle le suit) ; les fées **orbitent** autour de lui.
  - **Oiseaux sensibles au vent** : lents, et leur progression **face au vent se réduit** (à 100 % ils stagnent presque sur place puis sont emportés dos au vent). Réutilise le vent d'artillerie existant — cohérent avec la windsock.
- **Désactivé en match à 1 PV** : un décompte d'une seule unité n'apporte aucune lecture progressive → on s'appuie alors uniquement sur les canaux d'appoint.
- **Couleur** : le cortège porte sa couleur de camp (identité) ; c'est le **nombre** qui dit les PV, pas la teinte (évite la confusion avec le canal ressources).
- **Canaux d'appoint (gros plan seulement)** : **usure** (suie + robe en lambeaux, miroir des fissures des tours) et **posture** (se voûte → claudique). Assumés **peu lisibles** sur un avatar petit et déjà encombré d'outils — renforts de très près, pas canaux d'information.
- **Bouclier magique (parade des obus non létaux, validé)** : tant que ce **n'est pas son dernier PV**, un **bouclier magique pare l'obus** — l'obus **explose sur le bouclier** (il perd 1 PV + une entité du cortège, mais **reste debout**). Sur son **dernier PV**, le bouclier est **à bout** : l'obus **éclate directement sur lui** → mort. Deux retours nets, visuels **et** audio : *parade* vs *impact fatal*. (Distinct du bouclier-munition des tours — c'est sa **défense innée**, jaugée par ses PV.) **Deux skins** de bouclier : **Hexagonal** (barrière cristalline facettée, scintillement) et **Vortex** (énergie tournante qui aspire l'obus) — chacun avec son rendu de *parade* et d'*effondrement au dernier PV*.
- **À 0 PV** : le corps reste au sol, **canonnable pour un bonus** (façon windsock, cf. supra) ; réapparition en planeur au centre après un délai.
- **Malus « tueur de l'Intendant » (validé)** : le duelliste qui **abat l'Intendant** se voit **interdire les munitions spéciales offensives pour le restant de la manche** — il ne lui reste que l'**obus normal** et **toutes les munitions défensives** (bouclier inclus, et tout futur consommable purement défensif). Garde-fou de neutralité côté duel : frapper le 3ᵉ joueur a un **coût offensif** (pas défensif), ce qui décourage de le prendre pour cible plutôt que de jouer le duel.

**Niveau 0 — perso/cosmétique (zéro impact duel, toujours safe)**
- **Moutons** à mener à l'abri : errent, paniquent aux explosions, meurent dans les tirs croisés / la lave.
- **Oiseaux** : s'envolent aux impacts ; s'ils dérivent avec le vent → **indicateur de vent diégétique utile aux deux joueurs également** (donc neutre).

**Niveau 1 — agit sur les soldats, neutre par centralité (cœur de la feature)**
- **Cours d'eau** : s'écoule dans les vallées (suit `heightAt`), ralentit les soldats, attire les moutons.
- **Lave** 🌋 (*killer mechanic*) : l'Intendant trace un chenal **au centre** → écoulement par gravité le long de la crête → **tue les soldats traversants** → **refroidit en roche et devient du nouveau terrain**. Fusionne terraformage + danger + résolution de combat. Superbe avec les biomes Desert/Storm existants.
- **Colline / vallée / rocher central** : oriente où les armées se rencontrent.

**Niveau 2 — bâtiments : neutres SEULEMENT sans bonus de camp** ⚠️
- **Tour de guet / bannière** : OK comme **point de ralliement** (les soldats des deux camps convergent → concentre le choc) ou **objectif central canonnable à récompense symétrique** (modèle du windsock actuel qui offre un bouclier).
- **Interdit** : tout bâtiment qui buffe celui qui le « tient » (vision, PV, dégât) → casse la neutralité.

### Garde-fous de neutralité (invariants)
1. L'Intendant **n'inflige jamais de dégât direct** à une tour ou à un soldat nommé.
2. Il **n'agit qu'au centre** (bande équidistante) → effets symétriques en espérance.
3. Ses actions ne sont **jamais ciblables** sur un camp précis.
4. Son **objectif est découplé** : il ne gagne rien à favoriser un duelliste.

---

### 3.3 Règles & décisions techniques (prototypées v6)
- **Déterminisme — interdiction du vrai `Math.random`** : toute l'aléa dérive d'une **seed** (PRNG mulberry32). Terrain, déclenchement des chutes, nombre de flèches par volée… tout est reproductible. (Cohérent avec `rng.js` côté jeu.)
- **Galeries / creusage** : creuser à l'horizontal agit en **basher** (ouvre un couloir au niveau du pied, sans effondrer la crête) ; creuser vers le bas agit en **digger** (puits). ⚠️ **Pas de passage à une « solidité 2D »** pour l'instant (pas de vrais tunnels avec plafond) — sujet explicitement reporté, à rediscuter si on veut de vraies galeries couvertes.
- **Structures vs obus** : les impacts d'obus (cratères) **découpent ponts et escaliers** et **creusent les barres de consolidation**.
- **Consolidation de pont** : à la pose d'un pont, **2 barres** (1 par côté, à 1 unité de build du bord) — *traversables par personnages et obus*, mais *creusées par les cratères*. Si le bord est **raccordé au sol** → **pilier oblique 45°** vers l'extérieur-bas ; sinon → **pilier vertical** vers le bas.
- **Build sûr** : la construction s'**interrompt** si elle sortirait du cadre ou passerait **sous le terrain** (plus de pont/escalier enterré) ; la base de construction est la **position réelle** de l'Intendant (fix de la téléportation verticale quand on bâtit sous un pont).
- **Avatar par biome** : **Mascotte** pour le biome **Orage**, **Robe** par défaut ailleurs (autres styles : Ouvrier, Éclaireur — à l'étude).

### 3.4 📋 COMMANDE — Annexe « Pathfinding » (à rédiger plus tard, cible docs-src/ 2.0.0)
Rédiger une annexe technique dédiée au routage des soldats. Plan attendu :
1. **Problème** : terrain 1D (heightfield) + ouvrages de l'Intendant (planches pont/escalier) ⇒ surfaces multiples par abscisse ; pourquoi un suivi local glouton échoue (n'embarque pas un escalier loin du mur).
2. **Modèle de graphe** : nœuds = `(colonne, surface)` où surfaces = sol + planches au-dessus du sol (`surfacesAt`) ; pas d'échantillonnage `STEP=8`. Arêtes = transitions vers colonnes adjacentes si la marche est franchissable (`montée ≤ SU`), descentes autorisées avec coût (chute).
3. **Algorithme** : Dijkstra/A* soldat → tour adverse ; coût = distance + pénalité de chute **+ pénalité de densité (désencombrement) + jitter seedé par soldat** ; reconstruction de waypoints. Déserte si aucun chemin.
3bis. **Désencombrement (implémenté v23)** : champ d'occupation par colonne du graphe (`buildDensity`, rebâti une fois par `step`, tous camps + horde, demi-poids aux voisins) ⇒ terme `densité × pathCongestion` ; plus un bruit `hash(jseed, colonne) × pathJitter` propre à chaque soldat (seed tiré à la naissance). Effet : la horde fan-out aux goulots. **Invariant** : termes positifs ⇒ faisabilité inchangée ; le test de traversée (`crossPath`) appelle `findPath` **sans** ces options pour rester un A\* pur. *À distinguer de la séparation locale des sprites (steering micro) — ici c'est du routage macro.*
4. **Suivi** : le soldat suit les waypoints, **colle sa hauteur à la surface réelle** la plus proche du profil planifié (pas de survol), gère montée/descente, **revient sur ses pas**.
5. **Invalidation/replanification** : `navVer` bump (cratères, constructions) + replan périodique (~0.7 s) ; les éditions de terrain continues (creuser/aplanir) sont prises au replan périodique.
6. **Performance** : taille du graphe (~N×surfaces), coût Dijkstra O(V²), staggering des replans ; pistes d'optim (tas binaire, cache partagé) si beaucoup d'unités.
7. **Outil de debug** : visualisation des chemins (vert/bleu) et pentes infranchissables (rouge) ; comment l'activer.
8. **Limites & extensions** : pas de vraie 2D (tunnels couverts) ; cas des structures enterrées (exclues) ; idées futures.

## 5. Tempo : monde vivant sous tour-par-tour

- L'artillerie conserve AIMING → FIRING → RESOLVING.
- La **simulation de monde** (soldats, fluides, animaux) tourne à **chaque tick serveur**, indépendamment de la phase d'artillerie.
- Conséquence : plus de « temps mort » pendant la visée → pression temporelle. Le shot-clock garde son rôle d'artillerie.

---

## 6. Scoring : la gloire et le podium à 3

> ⚠️ **Largement SUPERSÉDÉ à l'intégration (v2.0)** — décision : **classement à 3 sur une échelle entière (points de victoire P1/P2 vs traversées P3), égalité → P3**. Cette règle d'égalité rend **caducs** la *monnaie de gloire séparée*, le *demi-point*, le *plancher MVP ≥ 50 %* et l'*extrapolation* décrits ci-dessous. Spec à jour : `regles.md §6bis` ; code : `src/sim/scoring.js`. La section reste ici pour l'historique de conception.

Monnaie unique = **gloire**.

| Rôle | Gagne de la gloire en… |
|------|------------------------|
| Artilleur | touchant la tour adverse, remportant une manche, et **ses soldats qui atteignent la tour adverse**. |
| Intendant | **traversée du champ** (ci-dessous), **moutons sauvés**, oiseaux préservés, « œuvres » de terrain achevées. |

> **Test de traversée (v20)** : la vérification de fin de manche utilise désormais **le vrai pathfinder** (prend en compte pont/escalier de l'Intendant) — fini les faux « infranchissable ». Un **debug visuel** (bouton *Debug chemins*) affiche les chemins valides (vert/bleu) et les pentes infranchissables du terrain (rouge).

> **Gloire de traversée (prototypé v3, affiné v6)** : l'Intendant gagne **+1 point de manche** si, en fin de manche, **un soldat peut traverser le champ** jusqu'à la tour adverse (chemin praticable compte tenu du terrain, des cratères et des structures qu'il a posées). Mise en scène : une **horde sort de la tour gagnante** (par la porte), **colonne resserrée et charge accélérée**, et **s'arrête / s'empile sur la ruine** de la tour vaincue. C'est sa contribution la plus directe au déroulé de la bataille : il *ouvre la route*.

**Podium à 3 en fin de partie.** Le duel a son vainqueur (inchangé), mais l'Intendant peut **coiffer tout le monde au classement gloire** et être **MVP**.

### Le principe qui rend le MVP-à-3 juste : la gloire se gagne **dans le danger**
- Sauver un mouton tranquille au fond de la map = peu de gloire.
- Arracher un mouton à la trajectoire d'un obus / le faire passer entre deux armées / le sauver d'une coulée de lave qui avance = **gros multiplicateur**.
- → Le scoring de l'Intendant s'accroche à l'intensité de la bataille : plus le duel chauffe, plus il a d'occasions héroïques. *Earn-through-play*, pas de farm en sécurité, meilleurs moments TV.

### Subtilité d'équilibre assumée
Comme les soldats rapportent de la gloire, la **lave centrale qui les fauche modifie le score des artilleurs**. C'est neutre **en moyenne** (centrale = tue les deux camps pareil), peut faire pencher une partie donnée → drama acceptable tant que les invariants §4 tiennent. **Choix fait les yeux ouverts.**

Garde-fou miroir : un obus qui frôle un troupeau le disperse (coût **incident** pour l'Intendant) — **jamais ciblable**, sinon les deux duellistes se liguent contre lui.

### Présence intermittente du 3ᵉ joueur
L'Intendant **n'est pas attendu** : il peut se connecter (ou se déconnecter) **en cours de partie**. Son scoring doit donc être équitable malgré un nombre de manches jouées variable (parties **first-to-N**, donc total de manches variable lui aussi).

- **« Manche pleinement participée »** = présent du **spawn de la manche jusqu'à sa résolution**. Une manche rejointe/quittée en cours est **exclue des deux côtés** (ni numérateur, ni dénominateur de sa moyenne).
- **Score comparable** = `moyenne_gloire_par_manche_pleine × manches_totales_de_la_partie`. On projette son rythme sur la durée réelle de la partie → même échelle de total que les artilleurs présents tout du long.
- **Plancher d'éligibilité au MVP** ⚠️ : il doit avoir pleinement joué **≥ 50 % des manches** de la partie. En dessous, il figure au podium comme **« invité d'honneur »** avec sa gloire **réelle (non extrapolée)**, mais **n'est pas classé pour le MVP**.
  - *Raison* : sans ce plancher, l'extrapolation sur petit échantillon (ex. arriver pour la dernière manche et vivre un moment héroïque) lui ferait **voler le MVP** d'un coup de chance — inacceptable puisqu'il peut vraiment gagner la partie.
- **Aucune manche pleine** → pas de score classé, simple spectateur-acteur.

---

## 7. Architecture & complexité

L'archi actuelle (**serveur autoritaire / TV spectateur / manettes = intentions seules**) encaisse tout sans changement structurel.

### Autorité & charge serveur — pourquoi on **n'offload pas** les soldats aux manettes
Tentation écartée : faire calculer l'intention de chaque soldat par les manettes, le serveur vérifiant la faisabilité. Net négatif :

- Le déplacement d'un soldat (`x += v·dt ; y = heightAt(x)` + quelques tests de blocage) est **trivialement bon marché** ; pour quelques dizaines de soldats c'est négligeable. **Pas de charge à soulager.**
- « Vérifier la faisabilité » oblige le serveur à **refaire le calcul** → coût payé **deux fois** + trafic des positions proposées. Net négatif.
- La **prédiction client** sert à masquer la latence d'input d'un *joueur* ; les soldats sont pilotés par l'IA → rien à masquer.
- Casserait le modèle serveur-autoritaire, le mode local 2 joueurs, et ouvrirait divergence + triche.

**Optimisations réelles, suffisantes :**
1. **État compact** par soldat dans le snapshot : `{id, owner, x, hp, état}` (~1 float + 2 octets). La TV reconstruit `y = heightAt(x)` localement. ~20 soldats ≈ ~5 ko/s à 30 Hz → négligeable.
2. **Dead-reckoning côté TV** (prédiction *visuelle* seule) : prolonger le soldat à sa dernière vitesse entre deux snapshots → rendu fluide. Aucune autorité.
3. Si le nombre de soldats explose un jour : **lockstep déterministe** (événements spawn/mort/combat + sim identique partout). Prématuré aujourd'hui.

→ **Serveur autoritaire, manettes muettes, sim déterministe** — l'archi actuelle tient.

### Outil : `design/battlefield-lab.html` (simulateur autonome)
Dans la lignée d'`ost-lab.html` et des arènes de difficulté. Canvas + sliders, sert à :
- **tuner le modèle de déplacement en live** : `v0`, courbe de pente (montée/descente), seuil de dévalage, portée d'engagement, dps, espacement de colonne, cadence de spawn, vitesse d'écoulement de la lave ;
- **prototyper la vue manette de l'Intendant** (palette d'outils + placement central + jauge) contre une bataille qui tourne.

Découple le tuning du jeu complet. **À construire en premier** (avant l'intégration serveur) pour valider les sensations.

### Points d'accroche dans le code existant
- **Terrain** : `terrain.js:61` `heightAt(x)` (O(1)) ; `terrain.js:79` `pointSolid()`. La marche des soldats et l'écoulement des fluides s'appuient dessus.
- **Tick serveur** : `Simulation.js:359-393` `tick(dt)` (fixe ~33 ms) ; `Simulation.js:395-408` `stepProjectiles(dt)`. Y ajouter un `stepWorld(dt)` qui tourne **hors** de la phase FIRING.
- **Collision** : `Simulation.js:427-517` `checkCollision()` — réutiliser l'échantillonnage de trajectoire (boucliers `441-470`, windsock `475-489`, tour `491-509`, terrain `511-516`) pour les hits sur soldats.
- **Snapshot** : `Simulation.js:626-658` — étendre avec `soldiers`, `fluids` (eau/lave), `animals`, `glory`.
- **Rendu TV** : `TvScene.js:651-669` `update()` — ajouter le rendu des soldats/fluides/animaux (Graphics, comme tours et projectiles).
- **Manettes** : `ControllerScene.js` — **3ᵉ persona « Intendant »** + sa vue (palette d'actions + jauge). Étend la machine à états des personas.

### Estimation (version mineure, à découper en lots)
| Lot | Périmètre | Ordre de grandeur |
|-----|-----------|-------------------|
| **1. Soldats** | spawn, marche sur crête, combat, hit par obus, gloire d'arrivée | sim ~250-350 l. + rendu ~80 l. |
| **2. Fluides** | écoulement eau/lave par gravité, lave qui tue + refroidit en terrain | sim ~150-250 l. + rendu ~80 l. |
| **3. Intendant** | 3ᵉ persona + vue manette + palette + animaux | ~200-300 l. |
| **4. Scoring** | gloire unifiée + podium à 3 + multiplicateur de danger | ~100 l. |

Complexité globale : **moyenne**. Rien d'architecturalement risqué ; c'est l'ampleur (sim continue + 3ᵉ joueur + nouveau scoring) qui en fait une **2.0.0**.

---

## 8. Points encore à défricher
- Combat soldat-contre-soldat : règles fines (PV, vitesse de duel, files de soldats vs mêlée).
- Écoulement de la lave : modèle (cellulaire ? front qui avance le long de `heightAt` ?), vitesse, refroidissement.
- Vue manette de l'Intendant : ergonomie de la palette (sélection d'outil + placement au centre), jauge/cooldown.
- Cadence de spawn des soldats : gratuit avec le temps ? lié à une ressource ? (à arbitrer avec la philosophie *earn-through-play*).
- Équilibrage chiffré de la gloire (plafonds comparables entre duel et Intendant).
