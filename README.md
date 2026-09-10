# 🤖🏸 Rogue Shuttle — prototype

Badminton arcade roguelite avec des robots, jouable dans le navigateur (iPhone en priorité).
Une **run** enchaîne 4 niveaux (Rookie, Pro, Elite, Boss). Chaque niveau se joue en 15 points,
avec le choix entre 3 cartes tous les 5 points et un modificateur de raquette au quinzième.
Si le bot atteint 15 avant toi, la run s'arrête. Le boss impose en plus un protocole tiré au sort.

## Jouer

- **Sur GitHub Pages** : activer Pages dans *Settings → Pages* (source *GitHub Actions*, ou *Deploy from a branch* en pointant la racine de la branche). Le workflow `.github/workflows/pages.yml` déploie automatiquement à chaque push sur `main`.
- **En local** : n'importe quel serveur statique, par exemple `npx http-server .` puis ouvrir l'URL sur le téléphone (même Wi-Fi).
- Sur iPhone : *Partager → Sur l'écran d'accueil* pour l'avoir en plein écran sans la barre Safari.

## Contrôles (schéma Game Boy)

Le coup part **au relâchement** du bouton et la raquette balaie aussitôt : mal calé, on frappe dans le vide.

| Entrée | Action |
| --- | --- |
| Croix | Déplacement 8 directions. Au relâchement elle règle la profondeur (bas = court, neutre = mi-court, haut = fond) et, en diagonale, le côté |
| **A** (neutre) | Drive mi-court (tendu, rapide) |
| **A + croix vers le bas** | Amorti (près du filet) ; en diagonale bas-gauche ou bas-droit, l'amorti part de ce côté |
| **A + croix vers le haut** | Drive profond, jusqu'au fond de court |
| **A maintenu** | Charge le smash : barre sous le robot, puis lueur blanche quand il est prêt. Relâché au bon moment il smashe, sinon il rate le volant |
| **B** (neutre) | Dégagé mi-court |
| **B + croix vers le bas** | Dégagé court et tendu, il tombe devant |
| **B + croix vers le haut** | Dégagé long, au fond de court |
| Frapper ou charger | Immobilise le robot : la croix ne sert plus qu'à viser |
| A ou B en pleine course, volant hors de portée | **Plongeon** : détente avec allonge, remise haute, puis 0,67 s au sol |
| Service | A court, B long |
| Clavier | Flèches / ZQSD, `A` (ou X, espace) et `B` (ou C), `Échap` = pause |

## Structure de la run

| Étape | Contenu |
| --- | --- |
| Niveau | **15 points** contre le même adversaire, score cumulé. Le bot à 15 arrête la run |
| Paliers de 5 et 10 points | Choix entre **3 cartes**, cumulables **3 fois** chacune |
| 15ᵉ point | Une carte **et** un modificateur de raquette, puis l'adversaire suivant |
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
| 🦿 Vérin de jambe | −18 % de temps de charge du smash |
| 🚀 Propulseur dorsal | +0,25 m de hauteur de smash rattrapable |
| 🏸 Volant lesté | +0,25 point par point gagné |

### Modificateurs de raquette (fin de niveau)

| Modificateur | Effet par niveau |
| --- | --- |
| 📏 Manche allongé | +0,18 m d'allonge |
| 🎯 Cordage tendu | −30 % de dispersion de la visée |
| 🪶 Tamis élargi | +30 ms de fenêtre de frappe et zone parfaite plus large |

## Systèmes de jeu

- **Trois profondeurs par bouton** : la croix vers le bas joue court, au neutre mi-court, vers le haut au fond. Les diagonales gardent la profondeur et ajoutent la visée latérale.
- **Fenêtre de contact** : le geste dure 0,30 s et ne touche qu'entre 0,04 s et 0,20 s. C'est là que se joue le timing.
- **Qualité = placement** : point idéal 35 cm devant le robot. FAIBLE / OK / PARFAIT. Une frappe faible est molle et une fois sur trois c'est une faute.
  Le **smash** demande une charge de 0,42 s et un volant à plus de 1,75 m ; au-dessus de 2,5 m le robot saute.
- **Jauge SUPER** : monte sur les coups bien placés (+3 pour un parfait), les smashs (+3), les sauts (+2) et les sauvetages (+5). Pleine, le robot s'auréole et son prochain smash devient un **SUPER SMASH** foudroyant qui vide la jauge.
- **Plongeon** : déclenché à la pression quand le point d'interception est hors de portée en courant, à moins de 2,7 m et à moins de 0,9 s. Détente de 0,30 s avec 0,85 m d'allonge en plus, puis 0,67 s d'immobilisation. L'IA plonge aussi.
- **Terrain** : dimensions réglementaires de simple, filet de badminton (bande haute à 1,55 m, maille de 760 mm qui ne descend pas au sol).
- **Châssis** : Light / Balanced / Heavy (vitesse, puissance de smash, vitesse de charge de la jauge, allonge).
- **Adversaires** : Rookie (BW-01), Pro (RG-02), Elite (RG-03 volant), Boss (ZG-04), chacun avec sa planche de sprites, son tempo et son taux d'erreur.

## Code

Pas de build ni de dépendances. Scripts classiques chargés par `index.html` :

- `src/physics.js` — intégrateur du volant + solveur de trajectoire (`planShot` : « atterrir là, avec cet angle ou cette vitesse, en passant le filet »).
- `src/game.js` — robots, contact/qualité, spécification des frappes, IA, score, Heat.
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
