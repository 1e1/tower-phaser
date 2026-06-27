# Script de conférence — ce que je dis, slide par slide

> Prompt oral en français, **aligné sur l'ordre réel du deck** (44 slides). À lire/adapter en parlant.
> Conventions : « **je** » quand je parle de moi, « **vous** » pour la salle.
> 🎬 *Ouverture de chapitre* = j'annonce ce qui vient. 🔨 *Martèlement* = UNE phrase, puis **un temps de silence**.
> Repères : `[n]` = numéro gravé sur la carte · 🎮 démo live · 🔗 lien/QR cliquable.
> 🎙️ **« Prompting 101 » (Anthropic, Moran & Ryan) = à l'ORAL uniquement** — jamais sur les slides. Posture : « j'ai codé ainsi *avant*, et j'ai découvert ce talk *après* — ça matche pile » (beats slides 7 & 21). Les slides montrent la *structure* (5 parties + balises XML, science empirique) sans la nommer.
> ⚡ **Deux longueurs (switch sur la slide titre)** : **Deep dive (~40 min)** = les 44 slides. **Lightning (~22 min)** = la navigation **saute 13 slides** taguées « ⚡ *coupé en Lightning* » : les 4 lots détaillés `[8–11]`, l'itération `[14]`, Technique 1 `[17]`, la constellation `[20]`, feedback `[27]`, fenêtre/cache `[28]`, garder le cap `[30]`, les briques `[33]`, accélérateurs `[34]`, value aval `[40]`. Reste **31 slides**. En Lightning, lis les beats marqués « ⚡ *report Lightning* » pour absorber en une phrase ce que la slide coupée disait.

---

## 🌱 Chapitre — Ouverture (Meadow)

### 1. Écran TV — titre `[1]`
« Bonjour à tous, et bienvenue. Ce que vous voyez, c'est l'écran d'accueil d'un jeu que j'ai construit : *Tower Duel*. Mais le sujet d'aujourd'hui, ce n'est pas le jeu — c'est **comment** je l'ai construit, en pilotant une IA. Je vais tout vous montrer : mes prompts, ma méthode, et aussi là où je me suis planté. »
*(Clin d'œil : je touche le switch.)* « Ce talk a deux longueurs — je les règle ici, comme un petit simulateur. »

### 2. Lobby — les 2 joueurs `[2]`
« Avant de jouer, posons les joueurs de la partie. Ils sont deux. **Moi** : le chef d'orchestre — je décide, je cadre, je valide. Et **l'IA** : l'exécutant — elle lit, écrit, teste, exécute. Gardez ce partage des rôles en tête : c'est tout le sujet du talk. »

### 3. Le déclic `[3]`
« Au départ, ce n'était même pas un projet de jeu. C'était un **terrain d'entraînement** : je voulais apprendre l'IA *agentique* sur un vrai projet, avec de vraies contraintes — temps réel, réseau, multijoueur. Et j'ai fini avec un vrai jeu, jouable à plusieurs. »

### 4. 🎮 DÉMO `[4]`
« Le plus simple, c'est de vous le montrer. » *(Je lance une manche — un·e volontaire ?)*
« Deux joueurs visent **en même temps**, puis les tirs partent ensemble ; le vent tourne, le terrain s'effrite… Sortez vos téléphones : le QR est à l'écran, vous pouvez jouer pendant que je parle. »

---

## 🏜️ Chapitre 1 — Le cadrage (Desert)

### 5. 🎬 Ouverture — « Framing beats prompting »
« Premier chapitre. La leçon tient en trois mots : **cadrer** compte plus que **prompter**. On va voir la décision de départ, le vrai brief que j'ai écrit, et les 4 lots qui en sont sortis. »

### 6. La décision fondatrice `[6]`
« Avant d'écrire une seule ligne, j'ai pris une décision : **découper en 4 lots**. Mon meilleur prompt n'a jamais été du code — c'était un **plan**. Un cap clair, c'est une IA qui ne part pas dans tous les sens. »

### 7. Anatomie du brief `[7]`
« Voici le brief réel, disséqué — et regardez : il tombe naturellement en **5 parties**, balisées en **XML**. La **tâche** : un classique d'artillerie, avec la variante — viser en même temps. Le **contexte** : le glossaire (un mot = un sens) et les conventions. Les **instructions** : 4 lots, du plus petit jouable au plus riche, dans cet ordre. Le **format de sortie** : sim séparé du rendu, *Done = docker compose up*. Et les **rappels** : un commit par lot, validé avant le suivant. Un bon brief dit le QUOI et le POURQUOI ; jamais le COMMENT. »
> 🎙️ *Beat « découverte après coup » (à DIRE, jamais à l'écran)* : « Honnêtement, j'ai écrit ça à l'instinct. Et **bien plus tard**, je tombe sur le talk d'Anthropic — *Prompting 101*, par Hannah Moran et Christian Ryan. Eh bien c'est **exactement** ça : task · context · instructions · examples · reminders, en balises XML. La preuve que bien cadrer, c'est universel — je l'avais fait sans le savoir. »
> ⚡ *report Lightning (les lots `[8–11]` sont sautés)* : enchaîne en une phrase — « Et ces 4 lots se sont enchaînés exactement dans cet ordre : du duel jouable dockerisé jour 1, jusqu'au terrain destructible façon *Worms*. » → puis directement le martèlement `[12]`.

### 8. Lot 1 — Le duel jouable `[8]` · ⚡ coupé en Lightning
« Lot 1 : le duel jouable, dockerisé dès le premier jour. Minimal mais **complet** — on a quelque chose à jouer tout de suite, et on itère sur du concret. »

### 9. Lot 2 — Biomes & ambiance `[9]` · ⚡ coupé en Lightning
« Lot 2 : l'identité. Thèmes visuels, parallaxe, son **synthétisé** — du code qui génère le son. Le jeu cesse d'être un prototype. »

### 10. Lot 3 — TV + manettes `[10]` · ⚡ coupé en Lightning
« Lot 3 : le saut technique. Une architecture **WebSocket** — la TV spectatrice, les téléphones-manettes, la reconnexion. »

### 11. Lot 4 — Terrain destructible `[11]` · ⚡ coupé en Lightning
« Lot 4 : le terrain destructible, façon *Worms*. La profondeur de jeu promise au départ est tenue. »

### 12. 🔨 Martèlement
« Un plan clair au départ, c'est une IA qui **livre** — pas une IA qui erre. » *(silence)*

---

## ❄️ Chapitre 2 — Momentum & méthode (Tundra)

### 13. 🎬 Ouverture — « How I actually drove it »
« Chapitre 2. Maintenant, concrètement : **comment** j'ai piloté. Les chiffres, mes trois techniques du quotidien, ma boucle de travail, et mon découpage en sessions. »

### 14. L'itération `[14]` · ⚡ coupé en Lightning
« Ensuite, l'itération : de lot 1 à la **v2.0.0**, sans jamais repartir de zéro. Turbo, boucliers empilables, matchs en N manches, mode 2 joueurs local, manche d'orage, et même un 3ᵉ joueur. »

### 15. Les chiffres `[15]`
« Et ils sont réels. Les 4 premiers lots ? **Une heure et demie.** Au total : **2 soirées** seulement avec des commits. 12 commits, jusqu'à la v2.0.0. ~12 000 lignes. Et surtout — **zéro réécriture complète**. Ce qui m'épate, ce n'est pas la vitesse : c'est de n'avoir **jamais eu à tout jeter**. C'est le cadrage qui paie. »

### 16. Ma boîte à outils `[16]`
« J'en tire trois techniques que j'utilise tous les jours — puis les principes qui les font marcher. »
> ⚡ *report Lightning (Technique 1 `[17]` est sautée)* : la 1ʳᵉ technique — décomposer en lots — a déjà occupé tout le chapitre 1. Dis : « La première, vous la connaissez déjà : découper en lots. Les deux autres, les voici. » → puis directement Technique 2 `[18]`.

### 17. Technique 1 — Décomposer en lots `[17]` · ⚡ coupé en Lightning
« Première : décomposer en lots. Un lot = un livrable jouable ou testable. L'IA est brillante en sprint cadré, perdue dans un marathon non balisé. Et ça me garde **maître de l'architecture**. »

### 18. Technique 2 — Forks & digressions `[18]`
« Deuxième : les forks. Quand j'hésite, je ne débats pas — je lance l'IA sur une **branche jetable**, je regarde le rendu, et si c'est mauvais, je jette tout sans remords. » *(exemple : le vent en easing continu — parti loin sur un fork… puis gardé pour le mode turbo.)*

### 19. Technique 3 — Simulateurs `[19]` 🔗 *carte flip*
« Troisième, ma préférée : je fais générer à l'IA **l'outil qui me permet de décider**. Voici le prompt… »
*(→ le 1ᵉʳ « suivant » retourne la carte : prompt → capture du lab.)*
« …et voilà le résultat : un labo audio jouable, que je règle à l'oreille. **Un simulateur par lot**, pour tester son évolution principale sur pièce. » *(la capture est cliquable → le vrai lab.)*

### 20. La constellation d'artefacts `[20]` 🔗 · ⚡ coupé en Lightning
« Et ça ne s'arrête pas au jeu. J'ai fait construire tout un **écosystème d'artefacts** : un labo de pathfinding, un bac à sable de bataille, un tutoriel en 5 langues. » *(ces captures sont cliquables — on ouvre les vrais labs.)* « Des outils que je n'aurais jamais pris le temps de coder à la main. »

### 21. La boucle (Lean) `[21]`
« Ma boucle de travail, très Lean : **un seul pari principal par lot**, choisi par priorisation. Je construis le test le plus rapide de ce pari — souvent un simulateur. L'implémentation laisse alors une **empreinte dans le code**, et je réaligne les consignes de l'IA dessus. C'est **structuré** — pas du patch à chaque idée qui passe. Les décisions sont fondées. »
> 🎙️ *Beat (à DIRE)* : « Anthropic a une formule pour ça, que j'ai croisée après coup : *le prompt engineering est une science empirique itérative* — un cas de test, on trouve l'échec, on encode le correctif, on recommence. C'est littéralement ma boucle. »

### 22. Beaucoup de sessions, un seul dépôt `[22]`
« Côté outils. Chaque onglet Claude Code = une **session parallèle** : son propre contexte, le même code. Les **sous-agents** font des jobs cadrés — explorer, relire — hors contexte. Et les tâches longues, je les lance en **arrière-plan** pendant que je pilote ailleurs. »

### 23. 🔨 Martèlement
« Teste vite le pari principal — et laisse l'**empreinte du code** guider l'IA. » *(silence)*

---

## 🌋 Chapitre 3 — Principes & posture (Volcano)

### 24. 🎬 Ouverture — « It's not the tool. It's the posture »
« Chapitre 3. Le vrai changement n'est pas dans l'outil — il est dans la **posture**. On arrive au cœur. »

### 25. Le contexte est tout `[25]` ⭐ idée maîtresse
« S'il n'y a **qu'une** chose à retenir aujourd'hui, c'est celle-ci : **le contexte est tout**. Personnaliser une IA, ça veut dire une seule chose : *décider ce qu'on lui donne*. Et le contexte, ce n'est pas que le code — c'est l'intention, comment vérifier, les contraintes, la marge de liberté, la vitesse, le niveau de collaboration. » *(exemple : le glossaire que je lui ai donné — un mot = un sens.)*

### 26. Outils > consignes `[26]`
« Premier corollaire, le plus rentable : **outils plutôt que consignes**. Plutôt que lui dicter les règles de style, je lui donne le **linter**. Mieux encore : de quoi vérifier son propre travail — tests, types, build. Un agent qui **s'auto-corrige** bat un agent qu'on reprend à la main. »

### 27. Le feedback est le levier `[27]` · ⚡ coupé en Lightning
« Deuxième principe : le **feedback** est le levier. Plus fréquent, plus précis, plus argumenté — exactement comme avec un collègue. Formalisez vos standards ; l'IA peut même *reverse-engineerer* vos reviews passées pour vous les proposer. »

### 28. La fenêtre de contexte `[28]` · ⚡ coupé en Lightning
« Une contrainte à maîtriser : la fenêtre de contexte est un **budget**. Le contexte ET la tâche la partagent. Et une astuce de coût : ce qu'on donne **en premier** est mis en cache — dix fois moins cher. Donc le stable d'abord, le volatile en dernier. »

### 29. De codeur à chef d'orchestre `[29]`
« Le vrai métier se déplace : de **codeur** à **chef d'orchestre**. Je décide, je cadre, je valide, je **refuse**. L'IA exécute. Le goulot d'étranglement passe du clavier au **jugement**. »

### 30. Garder le cap `[30]` · ⚡ coupé en Lightning
« Pour tenir dans la durée : une **mémoire de conventions** persistantes, et des rappels réguliers — *simplifie, capitalise*. Sans ça, la dette monte et on perd le contrôle de sa propre base de code. »

### 31. 🔨 Martèlement
« Le goulot d'étranglement a changé de place — du **clavier** vers le **jugement**. » *(silence)*

---

## ⛈️ Chapitre 4 — Machinerie & cicatrices (Storm)

### 32. 🎬 Ouverture — « The scars — and what the data says »
« Chapitre 4, le plus honnête. Les **cicatrices** — et ce que dit la **donnée**. »

### 33. Les briques `[33]` · ⚡ coupé en Lightning
« Pour les curieux, de quoi tout ça est fait : **CLAUDE.md** chargé en permanence ; les **skills** à la demande ; les **hooks** à zéro token ; les **sous-agents** hors contexte ; le **MCP** pour les outils génériques ; et la **mémoire**, gérée par le modèle. »

### 34. Accélérateurs `[34]` · ⚡ coupé en Lightning
« Et les accélérateurs : **explorer → planifier → coder**, l'auto-vérification, les **worktrees**, le **mode auto**, le **/loop**, le contrôle à distance, et l'hygiène de session. » *(crédit : le talk de Daisy Hollman.)*

### 35. Cicatrice 1 — Boucles & régressions `[35]`
« Maintenant, honnêtement, les cicatrices. Un : **boucles et régressions**. L'IA recasse ce qui marchait, tourne en rond, réintroduit un bug déjà corrigé. Les **tests** et le **versionnage** ne sont pas optionnels — ce sont eux qui la rattrapent. »

### 36. Cicatrice 2 — Dette & sur-ingénierie `[36]`
« Deux : **dette et sur-ingénierie**. Par défaut, elle génère **trop** — des abstractions inutiles, du code en double. La simplicité, il faut la **réclamer**, explicitement, souvent. »

### 37. Cicatrice 3 — Le coût du pilotage `[37]`
« Trois : **le coût du pilotage**. Cadrer, relire, corriger : ça prend du temps. Le gain est réel — mais l'illusion du gain **instantané** coûte cher. »

### 38. La règle d'or `[38]`
« Et la règle d'or : savoir quand **ne pas** faire confiance. On vérifie tout ce qui compte. La confiance se mérite — ligne à ligne, test à test. »

### 39. Écrire du code ≠ livrer de la valeur `[39]`
« Prenons de la hauteur. Une étude sur **100 000 développeurs** GitHub : avec les agents autonomes, **+180 %** de commits… mais seulement **+50 %** de projets, et **+30 %** de versions réellement livrées. Près de trois fois plus d'activité de code — à peine +30 % de logiciel fini. »
> 📚 *Source (à citer) :* Demirer, Musolff & Yang, « *Writing Code vs. Shipping Code* », **NBER Working Paper n°35275**, mai 2026 — https://www.nber.org/papers/w35275 (colonne grand public : CEPR/VoxEU).

### 40. Le goulot s'est déplacé en aval `[40]` · ⚡ coupé en Lightning
« Pourquoi cette évaporation ? Parce que le code n'est que la **matière première**. La valeur vient **après** : revoir, intégrer, tester, livrer — puis vendre, distribuer, faire adopter. Et tout ça reste **humain**. » *(et au passage : cet article dont je tire ces chiffres, j'ai* essayé *de l'écrire avec l'IA — biais, contresens, répétitions — je l'ai refait à la main. La preuve que le jugement reste nous.)*

### 41. 🔨 Martèlement
« La valeur, ce n'est pas le **volume de code** — c'est tout ce que les humains font encore **après**. » *(silence)*

---

## 🌅 Clôture (Meadow — aube)

### 42. À emporter `[42]`
« Ce que vous pouvez emporter dès demain. Un : **donnez tout le contexte** — c'est ça, la vraie personnalisation. Deux : **cadrez en lots**, **forkez** pour explorer sans risque. Trois : **outils plutôt que consignes** — donnez-lui de quoi se vérifier. Quatre : **surveillez la fenêtre de contexte**. Cinq : restez le **chef d'orchestre**. Et n'oubliez pas : la valeur n'est pas dans le volume de code. »

### 43. ✦ Dézoom — « all this »
*(la caméra recule : tout le parcours apparaît, les biomes en enfilade.)*
« Tout ça — le jeu, les versions, l'archi réseau, la méthode, le tutoriel en 5 langues — c'est **une seule trajectoire**. **Pilotée.** Pas magique : dirigée. »

### 44. 🎆 Merci `[44]` 🔗
« Merci ! Le **code** est sur GitHub, et restons en contact sur **LinkedIn** — les deux QR sont à l'écran. Et pour lancer la discussion, ma question pour vous : **lequel de vos projets gagnerait à être cadré en lots dès maintenant ?** » *(le jeu est en ligne — affrontez-vous pendant les questions.)*
