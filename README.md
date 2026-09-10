# 🤖🏸 Rogue Shuttle — prototype

Badminton arcade avec des robots, jouable dans le navigateur (iPhone en priorité).
Cette version est le **prototype de concept** : un match, premier à 15, sans les modules roguelite.

## Jouer

- **Sur GitHub Pages** : activer Pages dans *Settings → Pages* (source *GitHub Actions*, ou *Deploy from a branch* en pointant la racine de la branche). Le workflow `.github/workflows/pages.yml` déploie automatiquement à chaque push sur `main`.
- **En local** : n'importe quel serveur statique, par exemple `npx http-server .` puis ouvrir l'URL sur le téléphone (même Wi-Fi).
- Sur iPhone : *Partager → Sur l'écran d'accueil* pour l'avoir en plein écran sans la barre Safari.

## Contrôles (schéma Game Boy)

| Entrée | Action |
| --- | --- |
| Croix | Déplacement 8 directions. Gauche/droite au moment de la frappe oriente le volant |
| **A** (tapé) | Drive (tendu, rapide) ; la frappe reste en attente sans bloquer la course |
| **A tapé + croix vers le haut** | Amorti (près du filet) |
| **A maintenu** (préparation) | La charge démarre après un temps mort de 0,14 s. Pleine à 0,36 s : smash si le volant est haut, jump smash s'il est très haut |
| **B** (tapé) | Dégagé long (haut, au fond) |
| **B tapé + croix vers le haut** | Dégagé court (tendu, mi-court) |
| Maintenir un bouton | Immobilise le robot ; la croix sert alors à orienter le coup. Seul le smash demande une préparation |
| Taper un bouton | Coup rapide : direction figée à la pression, robot libre de continuer à courir |
| Service | A court, B long |
| Clavier | Flèches / ZQSD, `A` (ou X, espace) et `B` (ou C), `Échap` = pause |

## Systèmes du concept déjà présents

- **Qualité = placement** : point idéal 35 cm devant le robot. FAIBLE / OK / PARFAIT. Une frappe faible est molle et une fois sur trois c'est une faute.
  Le **smash** est le seul coup à préparer : A maintenu 0,36 s avant l'impact, sinon drive précipité. Volant au-dessus de 2,5 m = jump smash.
- **Hauteur du volant** : vraie trajectoire avec traînée aérodynamique ; dégagé, drive, amorti, smash ont des formes différentes.
- **Heat** : smash +15, drive +5, amorti −6, dégagé −4, refroidissement passif. À 100 → Overheat (−30 % vitesse, 3 s).
- **Châssis** : Light / Balanced / Heavy (vitesse, smash, chauffe, refroidissement, allonge).
- **Match à 15**, deux points d'écart, plafond 20, service par le gagnant de l'échange.
- **IA** : Rookie / Pro / Elite / Boss (vitesse, réaction, agressivité, taux d'erreur) et **tempo** du jeu : robots et volant plus lents en Rookie, plus rapides en Elite.

## Code

Pas de build ni de dépendances. Scripts classiques chargés par `index.html` :

- `src/physics.js` — intégrateur du volant + solveur de trajectoire (`planShot` : « atterrir là, avec cet angle ou cette vitesse, en passant le filet »).
- `src/game.js` — robots, contact/qualité, spécification des frappes, IA, score, Heat.
- `src/render.js` — pixel art façon Game Boy : tampon 192 px de large, fausse perspective, sprites de l'atlas, police pixel.
- `src/sprites.js` — atlas embarqués RG-B1 (héros), BW-01 (bot Rookie) et RG-03 (bot Elite), générés par `tools/extract_sprites.py` depuis `assets/*-sheet.png`.
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
