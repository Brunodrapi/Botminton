# 🤖🏸 Rogue Shuttle — prototype

Badminton arcade avec des robots, jouable dans le navigateur (iPhone en priorité).
Cette version est le **prototype de concept** : un match, premier à 15, sans les modules roguelite.

## Jouer

- **Sur GitHub Pages** : activer Pages dans *Settings → Pages* (source *GitHub Actions*, ou *Deploy from a branch* en pointant la racine de la branche). Le workflow `.github/workflows/pages.yml` déploie automatiquement à chaque push sur `main`.
- **En local** : n'importe quel serveur statique, par exemple `npx http-server .` puis ouvrir l'URL sur le téléphone (même Wi-Fi).
- Sur iPhone : *Partager → Sur l'écran d'accueil* pour l'avoir en plein écran sans la barre Safari.

## Contrôles (schéma Game Boy)

Le coup part **au relâchement** du bouton et la raquette balaie aussitôt : mal calé, on frappe dans le vide.

| Entrée | Action |
| --- | --- |
| Croix | Déplacement 8 directions. La direction au relâchement oriente le coup |
| **A** | Drive (tendu, rapide) |
| **A + croix vers le haut** | Amorti (près du filet) |
| **A maintenu** | Charge le smash : barre sous le robot, puis lueur blanche quand il est prêt. Relâché au bon moment il smashe, sinon il rate le volant |
| **B** | Dégagé long (haut, au fond) |
| **B + croix vers le bas** | Dégagé court (tendu, mi-court) |
| Charger | Ralentit le robot à 45 % de sa vitesse |
| A ou B en pleine course, volant hors de portée | **Plongeon** : détente avec allonge, remise haute, puis 0,67 s au sol |
| Service | A court, B long |
| Clavier | Flèches / ZQSD, `A` (ou X, espace) et `B` (ou C), `Échap` = pause |

## Systèmes du concept déjà présents

- **Fenêtre de contact** : le geste dure 0,30 s et ne touche qu'entre 0,04 s et 0,20 s. C'est là que se joue le timing.
- **Qualité = placement** : point idéal 35 cm devant le robot. FAIBLE / OK / PARFAIT. Une frappe faible est molle et une fois sur trois c'est une faute.
  Le **smash** demande une charge de 0,42 s et un volant à plus de 1,75 m ; au-dessus de 2,5 m le robot saute.
- **Hauteur du volant** : vraie trajectoire avec traînée aérodynamique ; dégagé, drive, amorti, smash ont des formes différentes.
- **Jauge SUPER** : monte sur les coups bien placés (+3 pour un parfait), les smashs (+3), les sauts (+2) et les sauvetages (+5). Pleine, le robot s'auréole et son prochain smash devient un **SUPER SMASH** foudroyant qui vide la jauge.
- **Châssis** : Light / Balanced / Heavy (vitesse, puissance de smash, vitesse de charge de la jauge, allonge).
- **Plongeon** : déclenché à la pression quand le point d'interception est hors de portée en courant, à moins de 2,7 m et à moins de 0,9 s. Détente de 0,30 s avec 0,85 m d'allonge en plus, puis 0,67 s d'immobilisation. L'IA plonge aussi, d'autant plus souvent que son niveau est élevé.
- **Match à 15**, deux points d'écart, plafond 20, service par le gagnant de l'échange.
- **IA** : Rookie / Pro / Elite / Boss (vitesse, réaction, agressivité, taux d'erreur) et **tempo** du jeu : robots et volant plus lents en Rookie, plus rapides en Elite.

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
