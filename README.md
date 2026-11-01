# Jeopardy

A local game-night workbench: question boards, phone buzzers, a private host desk and a separate presentation screen.

## Run

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open **http://localhost:43187**. Vite hot reload and Socket.IO share this one port. The terminal also prints the LAN address: players open that address on the same Wi-Fi, see the game list, and join. Invite players from the host's room button to show a QR code. The server binds both IPv4 and IPv6; it fails if the port is occupied rather than silently choosing another app's port.

Choose another port with `PORT=43189 npm run dev`.

For a production build:

```sh
npm run build
npm start
```

## Play

Create a blank board with a name and theme, or import a game from JSON. Before starting, Questions is the default tab and Live is disabled. Add categories and question rows as needed; new rows increment by 100 across every category. Blank cells say “No question” and cannot be selected during play. Editors save automatically, with text changes debounced by 450 ms. Start game is in the header. The host desk has five tabs: Live, Questions, Modifiers, Appearance and Settings. Open **Presenter** in a second window for the projector. Answers and host notes stay on the private host connection until the server's reveal deadline.

Players have a persistent seat on their phone: a ready button, live score, buzzer, player-controlled modifiers, final wagers and written final answers. If enabled in Settings, the last correct player chooses the next question from their phone.

Host shortcuts: **Space** toggles buzzers, **R** reveals, **N** returns to the board, **Ctrl/Cmd+Z** undoes an action. Shortcuts are inactive while typing or while a dialog is open.

The buzzer order is the order messages reach the server. This PoC does not perform network-latency compensation; keeping players on the same Wi-Fi gives the most consistent results.

## Modifier builder

Rules have **When → If → Then**:

- Triggers: manual, correct answer, wrong answer, question opens, round starts.
- Conditions: actor/opponent score, rank, round number or question value. All conditions must match. Rank `-1` means last place.
- Actions: add, multiply, set, transfer, swap, floor/ceiling, lock a buzzer or add a shield. Actions execute in order.
- Targets: actor, chosen opponent, leader, last place, everyone, other players or a random opponent.
- Values: a fixed number or a multiple of the question value, actor score or target score. Use `0.3 × target score` to steal 30%.
- Limits: uses per player, optional per-round reset, point cost and cooldown in questions.

Automatic rules use the last correct player as the actor (or the first joined player until someone answers). Their selected opponent is the highest-scoring other player. Question-open rules apply globally unless the question explicitly selects a subset in its editor. Manual rules always use the host/player's selected actor and opponent.

The test panel simulates a draft without changing live scores. Score theft cannot mint points when a shield blocks it. A shield absorbs a single score reduction. Undo restores scores, modifier charges, shields, gameplay state and the activity log together.

## Questions & media

CommonMark + GitHub Flavored Markdown: headings, tables, lists, tasks, code blocks, strikethrough, footnotes and image references. Raw HTML is sanitized. Scripts and unsafe URL schemes are removed.

```md
![Still from the film][still]

[still]: /media/example.gif

[Watch clip](https://example.com/clip.mp4)
[Listen](https://example.com/sound.mp3)
[YouTube](https://youtu.be/VIDEO_ID)
```

Use **Add media** to upload local PNG/JPEG/WebP/GIF, MP4/WebM or MP3/WAV/OGG files (up to 100 MB). Videos and audio show native playback controls; browsers may require a click before playback. Remote media needs an internet connection. Fonts and uploaded assets are served locally.

## Storage & access

Game state saves atomically in `data/games.json`; uploads live in `public/media/`. Back up both. JSON export/import moves definitions, settings and modifier rules; media URLs remain references, so copy uploaded media separately. Player connections recover after a server restart.

The host capability is stored in that browser's local storage. It is not sent to players or exported with the pack. To use the same host desk in another browser, a private URL of the form `/host/ROOM#key=HOST_TOKEN` is supported. Treat it as access to the desk. Changing the browser origin (for example, localhost to a LAN IP) changes its local storage. The local `data/games.json` is the recovery source for the host token.

This is a trusted-LAN PoC, without accounts or TLS. The game list and uploaded media are visible to devices that can reach the server. Teams, tournament seasons, packaged media exports and a visual animation timeline are not implemented yet.

## Verify

```sh
npm test
npm run build
```

Tests cover server authority, secret redaction, simultaneous buzzes, wrong-answer lockout, timers, final wagers, composed modifiers, shields, undo, persistence and reconnection. Tests use disposable storage and an ephemeral port. GUI checks must run on a private virtual desktop via the `isolated-gui` helper, never on the user's inherited display or session bus.
