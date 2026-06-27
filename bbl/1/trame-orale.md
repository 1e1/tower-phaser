# Trame orale — Brown bag « Coder avec une IA agentique »

> **Format** : ~22 min (Lightning) à ~40 min (Deep dive) + Q&A · audience mixte · dev pros hors gamedif.
> **Support** : `index.html` (impress.js), **en anglais**, plein écran (`F11`). **Deck = 44 steps** (Lightning en saute 13 → 31).
> ⚠️ **Doc canonique slide-par-slide = `script-conference.md`** (aligné 1:1 sur l'ordre réel du deck, avec les tags « ⚡ coupé en Lightning »). Le déroulé en bas de CE fichier garde une **numérotation héritée décalée** (antérieure à plusieurs slides) — fie-toi au contenu, pas aux numéros.
> **Notes orales** : ce document, **en français** (→ DeepL pour l'EN si besoin).
> **Les 4 messages** : (1) changement de posture, (2) retour honnête, (3) méthodes réutilisables, (4) inspirer/désinhiber.
> **Tension maîtresse** : *un cadrage initial parfait (4 lots + brief) vs. le besoin permanent de reprendre la main (simplifier, vérifier).*
> **Idée maîtresse (apex, slide 16)** : *personnaliser une IA = décider ce qu'on lui donne. Le contexte est tout.*

### 🎨 Refonte visuelle (thème jeu/doc — un biome par chapitre)
Le support reprend l'identité du jeu : **6 chapitres = 6 biomes**, le ciel bascule à chaque chapitre.
- 🌱 **Meadow — Ouverture** : écran TV qui « démarre » (titre + code de salle + switch durée) → **lobby** (les 2 joueurs : 🧑 toi = chef d'orchestre, 🤖 l'IA = exécutant) → le déclic → démo.
- 🏜️ **Desert — Le cadrage** : décision fondatrice + le brief réel + les 4 lots.
- ❄️ **Tundra — Momentum & méthode** : itération + chiffres + les 3 techniques (lots, forks, simulateurs) + **la boucle Lean** (« tester le pari principal vite » ; l'implémentation laisse une empreinte → je réaligne les consignes de l'IA) + **le découpage** sessions/onglets/agents (onglet = session //, sous-agent = job cadré, background = tâche longue).
> ✍️ **Pronoms** : quand tu parles de toi, dis « je » (pas « you »). Le « you/your » est réservé aux conseils adressés à la salle (à emporter, démo). Les cartes-prompts sont taguées « 👤 me ».

### 🎤 Format keynote (Apple/Jobs) — chaque chapitre du cœur
Chaque chapitre = **ouverture** (plein-cadre, « ce qu'on va voir », caméra en **dézoom**) → **corps** (cartes détaillées) → **martèlement** (plein-cadre, UNE phrase, caméra en **zoom-avant/punch**). Les 4 phrases à marteler :
- **Ch.1 Desert** : « A clear plan up front = an AI that ships, not one that wanders. »
- **Ch.2 Tundra** : « Test the main bet fast — let the code's imprint steer the AI. »
- **Ch.3 Volcano** : « The bottleneck moved — from the keyboard to judgment. »
- **Ch.4 Storm** : « Value isn't code volume — it's everything humans still do after. »
> Sur l'ouverture, annonce les 2-3 points ; sur le martèlement, **marque un temps de silence** après la phrase. (Deck = 44 slides ; les ouvertures/martèlements ne sont pas numérotés.)

### 💡 Anecdotes à raconter (tirées du cours / des annexes — vraies)
- **L'astuce de Quake (√)** *(slide artefacts)* : l'IA a même écrit une annexe « maths rapides » sur la *fast inverse square root* de Quake III (`0x5f3759df`). La leçon qu'elle en tire — et que j'applique — : **la meilleure optimisation, c'est le calcul qu'on ne fait pas** (on compare les distances *au carré*, on saute la racine). « Connaître le coût de ce qu'on calcule. »
- **L'oscilloscope de l'Intendant** : le petit oscilloscope sur la manette du 3ᵉ joueur n'est pas une déco — c'est **littéralement le graphe de pathfinding A\*** des soldats, colorié par franchissabilité, affiché en HUD. Une viz de debug **devenue une feature de jeu**.
- **Le fork jeté** *(slide forks)* : le vent en easing continu, exploré sur une branche jetable, ressenti en match… puis gardé (turbo) — l'exploration quasi gratuite.
- **Le tutoriel en 5 langues** *(slide chiffres / artefacts)* : l'IA a produit un carnet pédagogique complet (5 langues, annexes deploy/maths/pathfinding/lobby) — un artefact que je n'aurais jamais pris le temps d'écrire à la main.
> Les screenshots des slides (flip simulateur, galerie) sont **cliquables** → ouvrent le lab/tuto live sur GitHub Pages. Sur la slide simulateur (« 19 »), le **1er → retourne la carte** (prompt → screenshot du lab), le **2e → avance**. Tu enchaînes donc : « voici le prompt » → *(→)* « voici le résultat » → *(clic)* « le voici en vrai ».
- 🌋 **Volcano — Principes & posture** : le contexte est tout (apex) + outils>consignes + feedback + fenêtre/cache + chef d'orchestre + garder le cap.
- ⛈️ **Storm — Machinerie & cicatrices** : briques + accélérateurs + les 4 cicatrices + **la leçon macro** (2 slides : « *Writing code ≠ shipping value* » avec les chiffres de l'étude, et « *le goulot s'est déplacé en aval* », σ≈0,25).
- 🌅 **Meadow-aube — Clôture** : à emporter → dézoom (carte des mondes) → finale + feux.

> 🌞 **Le soleil** décrit un arc lever→coucher = jauge de progression (sans numéro). Le **numéro de step** (séquentiel : 1, 2, 3…) est gravé en **relief** dans le coin bas-droite de chaque carte (un peu plus foncé sur fond clair, un peu plus clair sur fond sombre). Les cartes claires ont une légère **texture grain de papier**.
> 💬 **Point d'orateur (à placer sur « code ≠ valeur » ou « ne pas faire confiance »)** : « Cet article dont je tire ces chiffres, j'ai *essayé* de l'écrire avec l'IA — biais, contresens, répétitions… je l'ai refait moi-même. Méta-preuve : l'IA produit la matière, la valeur (le jugement, la justesse) reste humaine. »
> ⚠️ **Numérotation** : une slide **lobby** a été ajoutée après le titre, donc les numéros du déroulé ci-dessous sont décalés de +1 à partir du « déclic ». Suis au **contenu** (les titres restent justes), je peux recaler tous les numéros si tu veux.

### 🔗 Liens (à garder ouverts / à montrer)
- **Jeu en ligne (TV + téléphones)** : https://1e1.alwaysdata.net — à donner à la salle.
- **Jeu local 2 joueurs (clavier)** : https://1e1.github.io/tower-phaser/play/?mode=local — démo de secours robuste.
- **Site / tutoriel (artefact généré, multilingue)** : https://1e1.github.io/tower-phaser — dont **l'annexe « Le brief de départ »** (source de la slide 5).

### 📚 Sources à créditer
- Talk de **Daisy Hollman — « Beyond the basics with Claude Code »** (partie principes/machinerie). Crédit affiché slide 23.
- **Chiffres « code ≠ valeur »** : Demirer, Musolff & Yang, *Writing Code vs. Shipping Code: Productivity Effects Across Generations of AI Coding Tools*, **NBER WP n°35275**, mai 2026 (DOI 10.3386/w35275) — https://www.nber.org/papers/w35275 · vulgarisation : CEPR/VoxEU. Chiffres-titres (résumé) : commits **+40 % / +140 % / +180 %** (autocomplétion / agents synchrones / asynchrones), atténués à **+50 %** de projets et **+30 %** de releases ; élasticité de substitution **σ≈0,25** (forte complémentarité IA↔humain).
- **Prompt structuré (5 parties + XML)** : aligné avec *Prompting 101* (Anthropic, Moran & Ryan) — **à mentionner à l'oral seulement** (découverte après coup), jamais sur les slides.
- Ton annexe « Le brief de départ » et ton article de synthèse.

---

## 🛣️ Deux parcours — un seul fichier, un interrupteur sur la slide titre

La slide 1 a un **switch « simulateur »** : **⚡ Lightning · 22 min** ↔ **🔬 Deep dive · 40 min**. Il **reconfigure le deck en direct** (sans recharger) : en Lightning, 13 slides « profondeur/détail » sont **sautées** par la navigation. Choix mémorisé (localStorage).

> 🔢 Numéros = **steps réels du deck** (cf. `script-conference.md`).

| Parcours | Ce qui change | Slides | Durée |
|---|---|---|---|
| **🔬 Deep dive (défaut)** | Tout développé | **44** | ~40 min |
| **⚡ Lightning** | Saute **13 slides** (voir liste) | **31** | ~22 min |

**Les 13 slides sautées en Lightning** (taguées « ⚡ coupé en Lightning » dans `script-conference.md`) :
- **5 slides `deep`** (référence/principe) : `[27]` feedback · `[28]` fenêtre+cache · `[33]` les briques · `[34]` accélérateurs · `[40]` value en aval.
- **8 slides `trim`** (détail redondant) : `[8–11]` les 4 lots détaillés (déjà résumés par `[6]` décision + `[7]` anatomie) · `[14]` itération · `[17]` Technique 1 (déjà = tout le ch.1) · `[20]` constellation d'artefacts · `[30]` garder le cap.

> **À régler avant de commencer** : choisis ton mode sur la slide titre. En Lightning, ces 13 slides n'apparaissent pas (→ la navigation les saute). Deux reports d'oral à connaître : après `[7]` résume les 4 lots en une phrase ; à `[16]` annonce « la 1ʳᵉ technique, vous la connaissez déjà » et enchaîne sur la 2. (Détail dans `script-conference.md`.)
> **Coupe d'urgence supplémentaire** (si tu débordes) : raccourcis une cicatrice (garde « le coût du pilotage `[37]` »), puis `[21]` la boucle Lean ou `[22]` les sessions.

## ⏱️ Minutage (parcours Deep dive, repère pas carcan)

| Bloc | Slides | Durée |
|---|---|---|
| 0. Accroche + déclic | 1–2 | 3 min |
| 1. **Démo live du jeu** | 3 | 3 min |
| 2. Le cadrage : décision + **brief réel** + 4 lots | 4–9 | 6 min |
| 3. Itération + **chiffres** + boîte à outils (2 mini-démos) | 10–15 | 8 min |
| 4. **Les principes** (le « pourquoi ») | 16–19 | 6 min |
| 5. La posture | 20–21 | 3 min |
| 6. **La machinerie** (référence) | 22–23 | 4 min |
| 7. Les cicatrices (retour honnête) | 24–27 | 5 min |
| 8. À emporter + dézoom + finale 3D | 28–30 | 3 min |
| **Q&A** | — | libre |

---

## ✅ Checklist avant de démarrer (5 min avant)

- [ ] `index.html` ouvert, plein écran, testé jusqu'à la finale (vérifier les feux d'artifice).
- [ ] **Mode choisi sur la slide titre** (⚡ Lightning ~22 / 🔬 Deep dive ~40) selon le temps et la salle.
- [ ] **Le jeu chargé d'avance dans un onglet** :
  - Principal : https://1e1.alwaysdata.net — **réveiller le serveur 2-3 min avant** (alwaysdata peut être en veille).
  - Secours : https://1e1.github.io/tower-phaser/play/?mode=local (clavier, zéro réseau).
- [ ] **Téléphones-manettes** testés ; 1-2 volontaires briefés, sinon tu joues les 2 camps en local.
- [ ] **Tes vrais exemples** sous la main (si tu veux compléter les cartes du deck) : un prompt de cadrage réel, un fork concret que tu as jeté, l'`ost-lab.html` ouvert.
- [ ] *(Deep dive)* un vrai **hook / skill / CLAUDE.md** à montrer 10 s sur la slide 22.
- [ ] Notifs coupées, chargeur branché, eau à portée.

---

## 🎤 Le déroulé, slide par slide

### Slide 1 — Titre · *(~30 s)*
« Bonjour. Je ne vais pas vous vendre une techno, je vais vous raconter une expérience : un vrai jeu, jouable à plusieurs, construit en pilotant une IA — avec ce qui marche et ce qui m'a cassé les dents. »
> *(Clin d'œil simulateur :)* montre le switch « ⚡/🔬 » : « Ce talk a deux longueurs — ce petit simulateur règle laquelle vous aurez. » Choisis ton mode. (Méta : cette présentation aussi a été co-construite avec l'IA.)
**Transition :** « D'abord, pourquoi un jeu ? »

### Slide 2 — Le déclic *(~2 min 30)*
- « Au départ, PAS un projet de jeu : un prétexte. Mon vrai objectif, apprendre l'**IA agentique** — pas l'autocomplétion, mais une IA qui lit, écrit, teste, exécute. »
- « J'ai choisi un jeu exprès : domaine non maîtrisé, contraintes réelles (temps réel, réseau, multi), et c'est *fun* à montrer. »
**Transition :** « Le plus simple, c'est de vous le montrer. »

### Slide 3 — 🎮 DÉMO LIVE *(~3 min)* ⚠️ moment clé
> La slide affiche **1e1.alwaysdata.net** : invite la salle à l'ouvrir sur leur téléphone.
**À faire :** onglet du jeu (déjà chargé) ; 1-2 volontaires rejoignent. Si le réseau lâche → **mode local** au clavier.
**À dire :** règle en une phrase (« on vise en même temps, on tire ensemble ») ; souligne 1-2 détails vendeurs (terrain destructible, bouclier, ambiance). Ne joue pas trop longtemps.
**Transition :** « Voilà le résultat. Comment on construit ça sans que ça parte en vrille ? Ça commence avant la première ligne de code. »

---

### Slide 4 — La décision fondatrice : 4 lots *(~1 min)*
- « Mon meilleur "prompt" n'a jamais été du code. **C'était un plan.** Cadrage en 4 gros lots, chacun livrable et jouable. »
- « Une IA est brillante en sprint cadré, perdue dans un marathon non balisé. »
**Transition :** « Et concrètement, ce brief, le voici — tel quel. »

### Slide 5 — Le brief réel (carte prompt) *(~2 min)* ⚠️ slide concrète clé
> C'est LA slide que réclamait l'exemple concret : le brief original, condensé, avec ses 4 annotations.
- « Voici le brief, presque mot pour mot. Regardez ce qu'il contient en 5 lignes : »
  - **📌 référence + intention** : "un classique d'artillerie" situe le genre ; "la variante : viser en même temps" dit ce qui rend CE jeu unique.
  - **🧱 4 lots incrémentaux** : du minimal jouable (docker) au riche (terrain destructible).
  - **📖 nomenclature** : tour, canon, volée, manche… « un mot = un sens ». Sans ça, "tour" = la structure ET le tour de jeu : le code et les écrans ne parlent plus la même langue.
  - **📐 conventions** : code en anglais, échanges en français, 1 commit par lot validé avant le suivant.
- *(Punch :)* « Un bon brief dit le **QUOI** et le **POURQUOI**, jamais le **COMMENT**. Le "comment" — fichiers, algos — c'est le métier de qui réalise (ici, l'IA). »
- *(Honnêteté, optionnel :)* « Le seul vrai manque : les critères de victoire et l'équilibrage, arrivés trop tard. »
**Transition :** « Avec ce cap, les 4 lots se sont enchaînés. »

### Slides 6-9 — Lot 1 → Lot 4 *(~3 min, ~45 s/lot)*
> Rythme rapide. Pour chaque : *ce que c'était* + *la leçon*.
- **Lot 1 — Le duel jouable :** minimal mais complet, dockerisé jour 1. « Avoir un truc jouable tout de suite — on itère sur du concret. »
- **Lot 2 — Biomes & ambiance :** thèmes, parallaxe, son *synthétisé*. « L'IA excelle sur le large mais bien défini. »
- **Lot 3 — TV + manettes :** archi WebSocket, écran + téléphones, reconnexion. « Sur l'archi, c'est moi qui tranche. »
- **Lot 4 — Terrain destructible :** la profondeur promise. « Le lot ambitieux en dernier. »
**Transition :** « Les lots, c'était le plan. Mais un projet vivant, c'est surtout l'après — et les chiffres parlent. »

---

### Slide 10 — L'itération *(~1 min)*
« De lot 1 à v1.3.2, sans jamais repartir de zéro. Turbo, boucliers empilables, matchs en N manches, 2 joueurs local, manche d'orage… avec la **simulation séparée du rendu** pour la réutiliser côté serveur. »

### Slide 11 — Les chiffres *(~1 min 30)* ⚠️ slide stats
> Chiffres réels (Git, hors commit initial = création du repo) : **les 4 lots en ~1h30** (repo vide 15:55 → terrain destructible 17:30 ; lot-1 16:23 → lot-4 17:30 = 1h07) · **2 soirées** seulement avec commits (mer. 17/06, tout v1.0.0→v1.3.2 d'un trait, et ven. 19/06 pour v2.0.0) · **12 commits / 11 tags** (→ v2.0.0) · **~12 400 lignes / 37 fichiers (src)**.
- « En chiffres : **les 4 premiers lots en ~1h30**, et au total **2 soirées** avec commits — 12 commits, 11 jalons taggés jusqu'à v2.0.0, ~12 400 lignes. »
- « La doc : **113 pages en 5 langues**, auto-traduites (DeepL). **Zéro réécriture complète** : on a empilé, jamais rasé. »
- *(Punch :)* « Ce n'est pas la vitesse qui m'épate, c'est de n'avoir jamais eu à tout jeter. C'est le cadrage qui paie. »
**Transition :** « J'en tire 3 techniques réutilisables dès demain. »

### Slide 12 — Ma boîte à outils *(~20 s)*
« 3 techniques que j'utilise tous les jours — puis les principes qui les font marcher. »

### Slide 13 — Technique 1 : Décomposer en lots *(~1 min)*
« Cadrer en lots avant de coder. Un lot = un livrable testable. Ça vous garde maître de l'architecture. 80 % de la réussite. »

### Slide 14 — Technique 2 : Forks & digressions *(~2 min)* ⚠️ carte prompt + mini-démo
- « Quand j'hésite, je ne débats pas : je lance l'IA sur un *fork*. » *(Lis la carte :)* « "Sur une branche jetable, transforme le vent en easing continu plutôt qu'en paliers — montre-moi le rendu, je garde ou je jette." »
- « Si c'est mauvais, je jette **tout sans remords**. Le fil principal reste propre. L'exploration devient quasi gratuite. »
**À faire :** montre ton fork concret préparé.

### Slide 15 — Technique 3 : Simulateurs & maquettes *(~2 min)* ⚠️ carte prompt + mini-démo
- « Au lieu de décider à l'aveugle, je fais générer **l'outil qui m'aide à décider**. » *(Lis la carte :)* « "Fais-moi un labo HTML autonome avec un curseur par paramètre de bande-son et par biome, qui joue en direct." → c'est l'`ost-lab.html`. »
- « Des bancs d'essai que je n'aurais jamais pris le temps de coder à la main. »
**À faire :** montre `ost-lab.html` (bouge un curseur, joue un extrait) + les presets.
**Transition :** « Ces 3 techniques marchent grâce à une poignée de principes. »

---

## 🧠 Les principes (le « pourquoi ») · *issu de l'article / talk de Daisy Hollman*

### Slide 16 — Le contexte est tout *(~2 min)* ⚠️ APEX + carte glossaire
- « S'il n'y a qu'une chose à retenir : **personnaliser une IA = décider ce qu'on lui donne.** Presque pas d'autre bouton. »
- « Le contexte, ce n'est pas que le code : l'**intention**, **comment vérifier**, les **contraintes**, la **liberté**, la **vitesse**, le **niveau de collaboration**. »
- *(Montre la carte glossaire :)* « Exemple concret de contexte que je lui ai donné : ce glossaire. *Un mot = un sens.* Résultat : code, écrans et échanges parlent enfin la même langue. »
**Transition :** « Premier corollaire, le plus rentable… »

### Slide 17 — Outils > consignes *(~1 min 30)* ⚠️ carte prompt
- « Entre donner les règles de formatage et donner accès au linter : le linter gagne. » *(Lis la carte :)* « "Ne te fie pas au style de mémoire — lance `npm run lint` et `build`, corrige, recommence jusqu'au vert." »
- « Un agent qui **s'auto-corrige** bat un agent qu'on reprend à la main. »

### Slide 18 — Le feedback est le levier *(~1 min)* · *masquée en Lightning* ⚠️ carte prompt
- « Du feedback plus fréquent, plus précis, plus argumenté — comme à un collègue. » *(Lis la carte :)* « "Cette abstraction n'apporte rien — une classe, pas trois. Inline et supprime la factory." »
- « Formalisez vos standards (Lean : un standard, puis chasse aux anomalies). L'IA peut même *reverse-engineerer* vos reviews passées. »

### Slide 19 — La fenêtre de contexte est un budget *(~1 min 30)* · *masquée en Lightning*
- *budget :* « Contexte ET tâche partagent une fenêtre. Les limites créent la performance — comme faire tenir un jeu dans quelques Ko. »
- *cache :* « Ce qu'on donne en premier est mis en cache, **10× moins cher**. Stable d'abord (CLAUDE.md, outils), volatile en dernier. Casse le cache : changer de modèle, brancher/débrancher un MCP, compacter, mettre à jour. »
**Transition :** « Tout ça suppose un changement de rôle. »

---

### Slide 20 — Le changement de posture *(~1 min 30)*
« De codeur à **chef d'orchestre** : je décide, cadre, valide, **refuse**. L'IA exécute. Le goulot passe **du clavier au jugement.** »

### Slide 21 — Garder le cap *(~1 min 30)*
« Deux garde-fous : **mémoire de conventions persistantes** + **rappels réguliers** ("simplifie, capitalise"). Sans ça : dette + perte de contrôle. »
**Transition :** « Pour les curieux, voici de quoi c'est fait. »

---

## 🔧 La machinerie (référence) · *adapte la profondeur ; masquée en Lightning*

### Slide 22 — Les briques *(~2 min, ou 30 s)*
> Lis la grille en 6 punchlines. Public avancé : montre 10 s un vrai hook / skill / CLAUDE.md.
- **CLAUDE.md** : chargé en permanence → règles qui s'appliquent partout uniquement.
- **Skills** : description toujours chargée, reste **à la demande** → économe.
- **Hooks** : sur votre machine, hors contexte → **0 token**.
- **Subagents** : un rôle + ses outils, **hors contexte**.
- **MCP** : outils *génériques* (emails, Jira…). En interne, préférez les skills.
- **Mémoire** : gérée par le modèle ; auditez via `/memory`. ≠ CLAUDE.md (vous).

### Slide 23 — Accélérateurs *(~2 min, ou 30 s)* · crédit Daisy Hollman
- **Explore → Plan → Code** (valider le plan avant) · **auto-vérif** (tests/types/build) · **worktrees** (sessions //, caches séparés) · **mode auto** (classifieur) · **/loop, dashboard agents, remote control** · **hygiène** (/clear, /compact, /rewind).
**Transition :** « Voilà la promesse. Soyons honnêtes : il y a des cicatrices. »

---

### Slides 24-27 — Les cicatrices *(~5 min)*
> Ton honnête, presque complice — ton capital crédibilité.
- **24 — Boucles & régressions :** recasse ce qui marchait, réintroduit un bug. « Tests et versionnage ne sont pas optionnels. »
- **25 — Dette & sur-ingénierie :** génère trop ; doublons. « La simplicité, il faut la réclamer. » *(Écho à la carte feedback slide 18.)*
- **26 — Le coût du pilotage :** cadrer/relire/corriger prend du temps. « L'illusion du gain *instantané* coûte cher. »
- **27 — La règle d'or :** « Savoir *ne pas* faire confiance. Vérifier ce qui compte. »
**Transition :** « Le tableau complet : la promesse ET les cicatrices. »

---

### Slide 28 — À emporter *(~1 min)*
« Cinq choses dès demain : 1) **Donnez tout le contexte** (la vraie personnalisation). 2) **Cadrez en lots**, **forkez**. 3) **Outils > consignes** : de quoi se vérifier. 4) **Surveillez la fenêtre/cache**. 5) Restez **chef d'orchestre**. »

### Slide 29 — Dézoom « all this » *(~30 s)* ⚠️ moment "waouh"
> La caméra recule et révèle le **couloir 3D** : les 8 actes alignés comme une galerie qui fuit en perspective.
« Tout ça — le jeu, les versions, l'archi, la méthode — un seul couloir, qu'on a parcouru. **Piloté.** Pas magique : dirigé. »
> *(Transitions : à l'intérieur d'un acte, léger zoom-avant ; entre actes, roulis + dézoom — la salle sent le changement de chapitre.)*

### Slide finale — « Thanks » + feux d'artifice *(~1 min + Q&A)*
> Affiche le **dépôt GitHub** (+ QR `github.com/1e1/tower-phaser`) et ton **LinkedIn** (`linkedin.com/in/agerlier`). (Le QR du jeu est sur la slide démo.)
« Merci. Ma question : **lequel de vos projets gagnerait à être cadré en lots dès maintenant ?** Le code est sur GitHub, et restons en contact sur LinkedIn. »

---

## 💬 Anticipation des questions (Q&A)

**Méthode / projet**
- **« Combien de temps ? »** → les 4 lots en **~1h30**, et **2 soirées** au total (17 & 19/06) ; le temps n'a pas disparu, il s'est *déplacé* (moins de frappe, plus de cadrage/relecture).
- **« Quel outil / modèle ? »** → factuel, puis recentre sur la *méthode*, transférable.
- **« Sur du legacy / du vrai code pro ? »** → lots + forks marchent encore mieux ; la vérification devient encore plus critique.
- **« Qualité / maintenabilité ? »** → cicatrice n°2 : sans réclamer la simplicité ni relire, la dette explose.
- **« ~12 400 lignes en 2 soirées, vraiment ? »** → oui, mais ce qui compte c'est **zéro réécriture** : le cadrage évite de tout jeter. Et beaucoup de lignes = doc générée + son synthétisé.

**Principes / machinerie** *(Deep dive)*
- **« MCP ou skill ? »** → en interne, **skills** ; MCP pour les outils génériques externes, si la confidentialité est garantie.
- **« Le cache, vraiment 10× ? »** → oui sur le préfixe (CLAUDE.md, outils) ; stable à gauche, volatile à droite.
- **« Le mode auto, pas dangereux ? »** → un classifieur bloque le destructeur/suspect ; le sûr passe.
- **« Pourquoi pas tout en worktrees ? »** → deux worktrees = deux répertoires = **caches séparés**.

## 🧠 Rappels pour toi, l'orateur
- **Assume les cicatrices** : crédibilité.
- **Ne survends pas** : « pilotée, pas magique ».
- **Lis les cartes-prompts à voix haute** : ce sont tes exemples concrets — la salle veut du vrai.
- **Adapte la profondeur** (slides 16-23) : novices → reste sur l'idée maîtresse ; confirmés → creuse cache, MCP/skills, worktrees.
- **Garde le fun** : la démo doit respirer la joie.
