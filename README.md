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

Une pression **fige** le robot et arme la visée, au centre du camp adverse. La croix choisit le bord vers
lequel elle glisse : elle s'en écarte vite, puis **freine** en approchant de la ligne. Le robot **clignote
en blanc** quand la visée atteint la ligne et **en rouge** quand elle la dépasse — relâche avant. Le coup
part **au relâchement**, vers la cible atteinte. La raquette balaie aussitôt : mal calé, on frappe dans le vide.

| Entrée | Action |
| --- | --- |
| **A** | **Coup droit** — le volant se prend à droite du robot |
| **B** | **Revers** — le volant se prend à gauche du robot |
| Croix ▲ / ▼ | La mire glisse vers le **fond** / vers le **filet** |
| Croix ◀ / ▶ | La mire glisse vers la **ligne de côté** ; les diagonales visent les coins |
| Durée du maintien | 0,2 s = déjà à mi-chemin du bord, 0,63 s = la ligne, au-delà de 0,8 s = **dehors** |
| Tempo de la frappe | Décide de la **précision** : bien calé le volant va chercher la ligne, mal calé il part n'importe où |
| Mauvais côté de raquette | Coup parfait interdit, dispersion × 1,5, mention *COUP DROIT FORCÉ* / *REVERS FORCÉ* |
| A ou B en pleine course, volant hors de portée | **Plongeon** : détente avec allonge, remise haute, puis 0,67 s au sol |
| Service | Mêmes règles, la mire restant dans la boîte de service adverse |
| Clavier | Flèches / ZQSD, `A` (ou X, espace) et `B` (ou C), `Échap` = pause |

Les consignes sont rappelées **sous les boutons** et changent après le service. Rien n'est dessiné dans
le camp adverse : c'est ton propre robot qui te dit où en est ta visée.

### La trajectoire découle de la cible

Le joueur ne choisit pas un type de coup : il choisit un point de chute, et la trajectoire s'en déduit.

| Cible | Coup |
| --- | --- |
| À moins de 2,2 m du filet | **Amorti** |
| À plus de 5 m du filet | **Dégagé** |
| Entre les deux, volant sous 1,85 m | **Drive** |
| Entre les deux, volant au-dessus de 1,85 m | **Smash** (au-dessus de 2,5 m, le robot saute) |

## Trois modes

- **Rogue lite** : choix du châssis, puis les 4 adversaires à la suite, avec les cartes et le protocole du boss.
- **Exhibition** : choix du châssis, puis de l'adversaire, pour un match libre en 15 points sans carte ni protocole.
- **En ligne** : duel 1v1 en match libre, ou coop 2v2 en rogue lite.

### En ligne

Deux formules, pas davantage — il n'y a qu'une seule chose à choisir.

| Formule | Terrain | Qui joue | Épreuve |
| --- | --- | --- | --- |
| **Duel 1v1** | Simple | Deux humains, un par camp | Match libre en 15 points |
| **Coop 2v2** | Double | Deux humains d'un côté, deux machines de l'autre | Rogue lite, 4 niveaux |

Le rogue lite se joue contre la machine : en solo, ou à deux du même côté. Un duel entre deux humains
n'a pas de camp adverse à faire progresser, c'est donc un match libre.

On crée une table ou on en rejoint une dans la liste ; chacun choisit son châssis, se déclare prêt, et
le match part quand les deux le sont. En coop, **chaque joueur a son propre deck** : à chaque palier
vous choisissez chacun votre carte et la manche repart une fois que les deux ont choisi.

#### Deux transports, selon l'hébergement

| Page | Transport | Comment on se trouve |
| --- | --- | --- |
| Artifact **claude.ai** | capacité `room` | Les tables ouvertes s'affichent ; il faut avoir partagé la page et être plusieurs à l'avoir ouverte en même temps |
| **GitHub Pages**, fichier local | **WebRTC** | Tu crées une table, tu donnes son code à quatre lettres, l'autre le saisit |

Dans les deux cas les données de jeu ne transitent par aucun serveur de jeu : sur claude.ai c'est la
plateforme qui les relaie, en WebRTC elles vont directement d'un appareil à l'autre. Rien n'est
conservé — fermer la page ferme la table.

En WebRTC, un **annuaire** public (le broker PeerJS) sert uniquement à présenter les deux navigateurs
l'un à l'autre au moment de rejoindre ; il ne voit jamais une seule frappe. C'est un service gratuit :
il peut être lent ou indisponible, et le jeu le dit alors au lieu d'attendre. Et faute de serveur de
relais, deux réseaux très fermés peuvent ne jamais réussir à se joindre directement.

Pour pointer son propre serveur de signalisation, poser avant le chargement du jeu :

```html
<script>window.ROGUE_SHUTTLE_RTC = { peer: { host: 'exemple.net', port: 443, path: '/', secure: true } };</script>
```

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

- **Visée glissante** : après un temps mort de 0,08 s, la visée quitte le centre du camp adverse. Elle s'en écarte d'un coup — à 0,2 s elle a déjà fait la moitié du chemin — puis freine : il faut 0,63 s pour être exactement sur la ligne, et insister jusqu'à 0,8 s pour la franchir. Un appui bref décale donc nettement, mais aller chercher le bord se mérite.
- **Le tempo décide de la précision** : sur une même visée, un coup parfait tombe à 16 cm de la cible et reste dans le court neuf fois sur dix ; un coup correct à 53 cm ; un coup faible à 1,29 m, et il sort trois fois sur dix. Le cordage tendu resserre cette dispersion jusqu'à − 90 %.
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
- `src/net.js` — jeu en ligne : salon, élection de l'hôte, instantanés et entrées. Il ignore quel transport le porte.
- `src/room-rtc.js` — le transport de secours : même surface que la capacité `room`, au-dessus de WebRTC, pour les pages hébergées hors de claude.ai.
- `src/main.js` — menus, HUD, boucle.

```bash
node tests/physics.test.mjs   # le solveur atterrit où on lui demande
node tests/match.test.mjs     # matchs complets simulés, simple et double, cartes et paliers
node tests/net.test.mjs       # un hôte et un invité, latence simulée : l'invité doit rester collé
NETDEBUG=1 NETLAG=9 node tests/net.test.mjs   # détaille les points et durcit la latence
node tools/online.mjs /tmp/shots              # deux navigateurs jouent l'un contre l'autre (transport claude.ai simulé)
MODE=coop node tools/online.mjs /tmp/shots    # …en coop 2v2, donc en rogue lite
node tools/online-rtc.mjs /tmp/shots          # …en WebRTC, comme sur GitHub Pages
node build.mjs                # dist/index.html mono-fichier (CSS + JS inclus)
python3 tools/extract_sprites.py   # régénère l'atlas de sprites (Pillow + numpy)
```

## Suite prévue (hors prototype)

Modules (Hydraulic Arm, Feather Scanner, Dash Servo, Redline CPU…), tournoi de 5 à 7 matchs,
événements et défis de score, apparence du robot qui change avec les modules.
