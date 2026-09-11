# 🤖🏸 Rogue Shuttle — prototype

Badminton arcade roguelite avec des robots, jouable dans le navigateur (iPhone en priorité).
Une **run** enchaîne 4 niveaux (Rookie, Pro, Elite, Boss). Chaque niveau se joue en 15 points,
avec le choix entre 3 cartes tous les 5 points et un modificateur de raquette au quinzième.
Si le bot atteint 15 avant toi, la run s'arrête. Le boss impose en plus un protocole tiré au sort.

## Jouer

- **Sur GitHub Pages** : activer Pages dans *Settings → Pages* (source *GitHub Actions*, ou *Deploy from a branch* en pointant la racine de la branche). Le workflow `.github/workflows/pages.yml` déploie automatiquement à chaque push sur `main`.
- **En local** : n'importe quel serveur statique, par exemple `npx http-server .` puis ouvrir l'URL sur le téléphone (même Wi-Fi).
- Sur iPhone : *Partager → Sur l'écran d'accueil* pour l'avoir en plein écran sans la barre Safari.

## Contrôles

Une pression **fige** le robot et fait apparaître la **mire** au centre du camp adverse. La croix choisit
le bord vers lequel elle glisse, et plus on maintient, plus elle s'en approche : au bout de 0,63 s elle est
sur la ligne, au-delà elle sort (elle rougit). Le coup part **au relâchement**, vers la cible atteinte.
La raquette balaie aussitôt : mal calé, on frappe dans le vide.

| Entrée | Action |
| --- | --- |
| **A** | **Coup droit** — le volant se prend à droite du robot |
| **B** | **Revers** — le volant se prend à gauche du robot |
| Croix ▲ / ▼ | La mire glisse vers le **fond** / vers le **filet** |
| Croix ◀ / ▶ | La mire glisse vers la **ligne de côté** ; les diagonales visent les coins |
| Durée du maintien | 0 s = centre du camp, 0,63 s = la ligne, plus longtemps = **dehors** |
| Mauvais côté de raquette | Coup parfait interdit, dispersion × 1,5, mention *COUP DROIT FORCÉ* / *REVERS FORCÉ* |
| A ou B en pleine course, volant hors de portée | **Plongeon** : détente avec allonge, remise haute, puis 0,67 s au sol |
| Service | Mêmes règles, la mire restant dans la boîte de service adverse |
| Clavier | Flèches / ZQSD, `A` (ou X, espace) et `B` (ou C), `Échap` = pause |

Les consignes sont rappelées **sous les boutons** et changent après le service.

### La trajectoire découle de la cible

Le joueur ne choisit pas un type de coup : il choisit un point de chute, et la trajectoire s'en déduit.

| Cible | Coup |
| --- | --- |
| À moins de 2,2 m du filet | **Amorti** |
| À plus de 5 m du filet | **Dégagé** |
| Entre les deux, volant sous 1,85 m | **Drive** |
| Entre les deux, volant au-dessus de 1,85 m | **Smash** (au-dessus de 2,5 m, le robot saute) |

## Deux modes

- **Rogue lite** : choix du châssis, puis les 4 adversaires à la suite, avec les cartes et le protocole du boss.
- **Exhibition** : choix du châssis, puis de l'adversaire, pour un match libre en 15 points sans carte ni protocole.

L'aide « zone d'arrivée du volant » du menu équivaut au premier niveau de la carte Optique prédictive.

## Structure de la run

| Étape | Contenu |
| --- | --- |
| Niveau | **15 points** contre le même adversaire, score cumulé |
| Paliers de 5 et 10 | Déclenchés dès que **l'un des deux** les atteint : choix entre **3 cartes**, cumulables **3 fois**. Un palier franchi par le bot te donne donc une carte de rattrapage |
| 15 points | Le bot devant, la run s'arrête. Toi devant, une carte de plus, un modificateur de raquette, puis l'adversaire suivant |
| Difficulté | Le bot gagne 4 % de vitesse à chaque palier franchi |

### Protocole du boss

Le dernier niveau tire au sort un handicap qui vaut pour ses 15 points :

| Protocole | Effet |
| --- | --- |
| 💨 Volant survolté | Le volant file 30 % plus vite |
| 🐌 Servos bridés | Ta course est ralentie de 25 % |
| 🌑 Capteur monochrome | Image en noir et blanc |
| 📜 Archive sépia | Image en sépia |
| 🙃 Gyroscope inversé | Le terrain est à l'envers |
| 🕶 Panne de lumière | Seuls le volant, les raquettes et la bande du filet restent visibles |
| 🚫 Lignes effacées | Le terrain n'a plus aucune ligne |

### Cartes (pièces du robot)

| Carte | Effet par niveau |
| --- | --- |
| 🦾 Servo de course | +12 % de vitesse de déplacement |
| 💥 Bras hydraulique | +15 % de puissance de smash |
| 👁 Optique prédictive | Ellipse d'arrivée du volant, de plus en plus resserrée |
| 🦿 Vérin de jambe | La mire glisse 18 % plus vite vers les bords |
| 🚀 Propulseur dorsal | +0,25 m de hauteur de smash rattrapable |
| 🏸 Volant lesté | +0,25 point par point gagné |

### Modificateurs de raquette (fin de niveau)

| Modificateur | Effet par niveau |
| --- | --- |
| 📏 Manche allongé | +0,18 m d'allonge |
| 🎯 Cordage tendu | −30 % de dispersion de la visée |
| 🪶 Tamis élargi | +30 ms de fenêtre de frappe et zone parfaite plus large |

## Systèmes de jeu

- **Mire glissante** : après un temps mort de 0,08 s, la visée quitte le centre du camp adverse et met 0,55 s à rejoindre la ligne. Viser les bords coûte donc du temps de préparation, et trop attendre envoie le volant dehors.
- **Imprécision de base** : même bien placée, la frappe est dispersée (± 0,30 m sur un coup parfait, ± 0,62 m sur un coup correct, ± 1,15 m sur un coup faible). Le cordage tendu réduit cette dispersion jusqu'à − 90 %.
- **Coup droit / revers** : le point idéal est décalé de 28 cm du côté de la raquette. Frapper du mauvais côté plafonne la qualité à OK et élargit la dispersion de moitié.
- **Fenêtre de contact** : le geste dure 0,30 s et ne touche qu'entre 0,04 s et 0,20 s. C'est là que se joue le timing.
- **Qualité = placement** : point idéal 35 cm devant le robot. FAIBLE / OK / PARFAIT. Une frappe faible est molle et part n'importe où.
- **Jauge SUPER** : monte sur les coups bien placés (+3 pour un parfait), les smashs (+3), les sauts (+2) et les sauvetages (+5). Pleine, le robot s'auréole et son prochain smash devient un **SUPER SMASH** foudroyant qui vide la jauge.
- **Plongeon** : déclenché à la pression quand le point d'interception est hors de portée en courant, à moins de 2,7 m et à moins de 0,9 s. Détente de 0,30 s avec 0,85 m d'allonge en plus, puis 0,67 s d'immobilisation. L'IA plonge aussi.
- **Terrain** : dimensions réglementaires de simple, filet de badminton (bande haute à 1,55 m, maille de 760 mm qui ne descend pas au sol).
- **Châssis** : Light / Balanced / Heavy (vitesse, puissance de smash, vitesse de charge de la jauge, allonge).
- **Adversaires** : Rookie (BW-01), Pro (RG-02), Elite (RG-03 volant), Boss (ZG-04), chacun avec sa planche de sprites, son tempo et son taux d'erreur.

## Code

Pas de build ni de dépendances. Scripts classiques chargés par `index.html` :

- `src/physics.js` — intégrateur du volant + solveur de trajectoire (`planShot` : « atterrir là, avec cet angle ou cette vitesse, en passant le filet »).
- `src/game.js` — robots, visée glissante, contact/qualité, spécification des frappes, IA, score, run.
- `src/render.js` — pixel art façon Game Boy : tampon 192 px de large, fausse perspective, sprites de l'atlas, police pixel.
- `src/sprites.js` — atlas embarqués : RG-B1 (héros), BW-01 (Rookie), RG-02 (Pro), RG-03 (Elite), ZG-04 (Boss), générés par `tools/extract_sprites.py` depuis `assets/*-sheet.png`.
- `src/input.js` — croix directionnelle fixe 8 directions, boutons A/B (Pointer Events), clavier.
- `src/audio.js` — sons synthétiques WebAudio.
- `src/main.js` — menus, HUD, boucle.

```bash
node tests/physics.test.mjs   # le solveur atterrit où on lui demande
node tests/match.test.mjs     # 9 matchs complets simulés (3 difficultés × 3 châssis)
node build.mjs                # dist/index.html mono-fichier (CSS + JS inclus)
python3 tools/extract_sprites.py   # régénère l'atlas de sprites (Pillow + numpy)
```

## Suite prévue (hors prototype)

Modules (Hydraulic Arm, Feather Scanner, Dash Servo, Redline CPU…), tournoi de 5 à 7 matchs,
événements et défis de score, apparence du robot qui change avec les modules.
