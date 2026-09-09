# 🤖🏸 Rogue Shuttle — prototype

Badminton arcade avec des robots, jouable dans le navigateur (iPhone en priorité).
Cette version est le **prototype de concept** : un match, premier à 15, sans les modules roguelite.

## Jouer

- **Sur GitHub Pages** : activer Pages dans *Settings → Pages* (source *GitHub Actions*, ou *Deploy from a branch* en pointant la racine de la branche). Le workflow `.github/workflows/pages.yml` déploie automatiquement à chaque push sur `main`.
- **En local** : n'importe quel serveur statique, par exemple `npx http-server .` puis ouvrir l'URL sur le téléphone (même Wi-Fi).
- Sur iPhone : *Partager → Sur l'écran d'accueil* pour l'avoir en plein écran sans la barre Safari.

## Contrôles

| Entrée | Action |
| --- | --- |
| Stick (pouce gauche, n'importe où à gauche) | Déplacement. Oriente aussi la frappe à gauche / à droite |
| **A** | Dégagé (haut et loin) |
| **B** | Amorti (près du filet) |
| **X** | Smash (volant haut obligatoire, sinon → drive) |
| **Y** | Drive (tendu, rapide) |
| Maintenir un bouton | Raquette armée : la frappe part quand le volant arrive |
| Clavier | Flèches / ZQSD + touches `A` `B` `X` `Y`, `Échap` = pause |

## Systèmes du concept déjà présents

- **Qualité = placement + timing** : point idéal 35 cm devant le robot. FAIBLE / OK / PARFAIT.
  Parfait = bien placé **et** bouton pressé moins de 0,45 s avant l'impact. Une frappe faible est molle et une fois sur trois c'est une faute.
- **Hauteur du volant** : vraie trajectoire avec traînée aérodynamique ; dégagé, drive, amorti, smash ont des formes différentes.
- **Heat** : smash +15, drive +5, amorti −6, dégagé −4, refroidissement passif. À 100 → Overheat (−30 % vitesse, 3 s).
- **Châssis** : Light / Balanced / Heavy (vitesse, smash, chauffe, refroidissement, allonge).
- **Match à 15**, deux points d'écart, plafond 20, service par le gagnant de l'échange.
- **IA** : Rookie / Pro / Elite (vitesse, réaction, agressivité, taux d'erreur).

## Code

Pas de build ni de dépendances. Scripts classiques chargés par `index.html` :

- `src/physics.js` — intégrateur du volant + solveur de trajectoire (`planShot` : « atterrir là, avec cet angle ou cette vitesse, en passant le filet »).
- `src/game.js` — robots, contact/qualité, spécification des frappes, IA, score, Heat.
- `src/render.js` — caméra perspective, terrain, filet, robots, volant, effets.
- `src/input.js` — stick virtuel flottant, boutons tactiles (Pointer Events), clavier.
- `src/audio.js` — sons synthétiques WebAudio.
- `src/main.js` — menus, HUD, boucle.

```bash
node tests/physics.test.mjs   # le solveur atterrit où on lui demande
node tests/match.test.mjs     # 9 matchs complets simulés (3 difficultés × 3 châssis)
node build.mjs                # dist/index.html mono-fichier (CSS + JS inclus)
```

## Suite prévue (hors prototype)

Modules (Hydraulic Arm, Feather Scanner, Dash Servo, Redline CPU…), tournoi de 5 à 7 matchs,
événements et défis de score, apparence du robot qui change avec les modules.
