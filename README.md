# Jeopardy

A local quiz game with phone buzzers, custom rules, and a separate presenter screen.

- Build question boards with Markdown, images, video, and audio.
- Hide a mystery modifier in a board cell. First to buzz claims it; the presenter applies the revealed instructions manually.
- Customize themes, rounds, and scoring.
- Prepare games in the library, then host from a focused gameplay screen.

## Run

Node.js 22.12+

```sh
npm install
npm run play
```

Use `npm run play` for game nights: it builds the app and runs the production server. Use `npm run dev` while changing code to keep hot reload.

Open [localhost:43187](http://localhost:43187). Players join using the LAN address printed in the terminal, on the same Wi-Fi. Open **Presenter** on your second screen.

## Local network security

The server accepts HTTP and Socket.IO connections from loopback and the subnet of one selected private IPv4 LAN interface. It prefers `en0`, otherwise the first physical private IPv4 interface, excluding common VPN/container interfaces. Set `LAN_INTERFACE=en0` (or your interface name) to select one explicitly. Without a private LAN interface, only loopback is allowed. Restart after switching networks. IPv6 connections are disabled. Forwarded-IP headers are ignored; this configuration is intended for direct LAN access, not a reverse proxy or public tunnel.

Host-header and browser-Origin checks reject unexpected addresses and cross-origin HTTP/WebSocket requests. This also prevents an unrelated website from using the loopback-only creation/host-claim endpoints through DNS rebinding. Direct navigation to a shared join or host-transfer link still works.

Only the server computer, or a browser holding a valid host key for an existing game, may create a game. A transferred host can create/copy games; player-only browsers have no Create game button. Viewing games and joining remain available on the selected LAN. Room PINs protect joining; game lists and presenter views remain visible to the LAN.

Limits per server: **100 games**, **1 GiB uploaded media** (including existing files), **100 MiB per file**, and one file per upload. Limits apply while streaming, including simultaneous/chunked uploads; failed or oversized uploads are removed. Existing files above the cap are preserved, and further uploads are rejected. Remove unused media while the server is stopped and restart to recalculate capacity.

Per source IP: **300 API requests/minute**, **30 join/claim/transfer requests/minute**, **20 new games/hour**, **10 uploads/minute**, and **60 Socket.IO handshakes/minute**. Socket.IO allows 128 simultaneous engine connections, and a socket sending over 60 actions/second is disconnected. Rate limits reset on server restart. These limits reduce abuse; they do not provide protection against a large network denial-of-service attack.

On macOS, run `npm run firewall:enable` in your terminal. The helper asks macOS for administrator authorization, allows the current Node executable, enables the application firewall, then prints both settings for verification. Repeat after changing the Node installation. It does not enable “block all incoming connections”, which would prevent phones from connecting.

Keep this app on a trusted LAN. HTTP traffic is still unencrypted. Do not configure port forwarding or publish a tunnel; HTTPS and a separate public-hosting security review are required before internet deployment. LAN source checks cannot distinguish a local peer from a proxy that forwards requests on its behalf.

## Development reloads

Keep `npm run dev` running while editing. Changes in `server/`, `shared/`, `vite.config.ts`, `tsconfig.json`, or `package.json` restart the server automatically. A restart saves the current game first; host, presenter, and player screens reconnect using their existing keys. Vite refreshes the page after a server restart, so allow pending edits to finish saving.

React and CSS edits in `src/` update through Vite without restarting the game server. Both watchers poll every 200 ms, including when filesystem change notifications are unavailable. Saved games and uploaded media do not trigger restarts.

After updating the dev command itself, stop and start `npm run dev` once to activate it.

## Prepare, then host

Open the **Game library** and choose **Create game** or **Edit**. Questions, hidden modifiers, appearance and settings are edited on a separate preparation page. Changes save automatically; **Done** waits for pending saves before returning to the library.

When your board is ready, choose **Host**, invite players and start. The host screen contains the board, buzzers, judging, scores and player status. It has no question, appearance or settings editor. **More** contains pause/resume, finish and reset. The host uses on-screen buttons for all game controls.

After a game starts, its definition is locked, including in editor tabs left open elsewhere. Choose **Copy & edit** in the library to prepare a fresh version while keeping the current game's players, scores and results. A reset returns the original to the lobby and allows preparation again.

## Transfer host access

On the host page, open **More → Transfer host access → Create transfer link**. Copy the link or scan its QR code in the receiving browser, then choose **Take over hosting** there. Links expire after 10 minutes; **Cancel transfer** revokes a pending link, and creating a replacement invalidates the previous one. Closing the dialog leaves the pending link usable until it expires or is cancelled.

The original host keeps control until the handoff is accepted. Acceptance rotates the host key and disconnects all previous host tabs while keeping players, scores, questions and progress. Both pending links and accepted access survive server restarts. The receiving browser saves its replacement key before requesting the handoff, so reloading and retrying can recover from a lost response. A disk save must succeed before the previous host is revoked, and gameplay undo cannot restore an old host key.

Choose a LAN address when moving to another device on the same Wi-Fi. Keep the game server running on the original computer: this transfers browser control, not the server or files. The link grants host access, so share it only with the intended host. This flow requires access to the current host browser to create the link; it is not recovery after clearing all browser storage.

## Media references

Question prompts, answers and notes store media as Markdown/HTML URLs, for example `![Photo](/media/example.jpg)` and `[Audio](/media/example.mp3)`. Uploaded files live under `public/media/`; bundled sample pictures use `/test-board/...` and live under `public/test-board/`. External HTTP(S) URLs remain external. A background image URL is stored separately as `theme.background`.

Game JSON contains these references, not the media bytes. Moving a game to another server requires copying uploaded files while preserving their paths. Browser host transfers use the same server, so media needs no copying. Built-in selection and announcement sounds are synthesized with Web Audio; they have no media-file reference. `theme.sound` controls announcement sounds, while screen mute choices live in browser session storage.

## Daily Double: give it to another team

Enable **Daily Double** on a question during preparation. When the presenter opens that cell, record the team that selected it and a different team they give it to, then choose **Confirm teams**. The receiving team must answer; buzzers stay closed throughout.

The presenter offers wager amounts verbally. The assigned team chooses one and enters it on their phone; the presenter can also record or correct that choice. Options are not configured or stored as a list. The host checks the chosen amount matches an offered option, then selects **Lock wager & open question**. Only the assigned team is judged, using **Correct** or **Incorrect / no answer**. An incorrect answer loses its wager, including when normal wrong-answer deductions are disabled.

Daily Double wagers are whole point amounts from 0 to 10,000,000, independent of current score and the Final wager limit. Reassigning before opening clears the previous team's wager. Assignment, stake and progress survive reload/restart; undo can correct judging. Legacy unfinished Daily Doubles return to the new assignment step when loaded. Final-round private wagers and answers keep their existing flow.

## Hidden modifiers

In **Game library → Edit → Questions**, open a cell and enable **Hidden modifier**. Enter its title and what it does, including any duration (for example, “Approximate answers allowed for the next 3 rounds”). The cell keeps its normal board value.

When selected, the presenter and phones show a mystery modifier with buzzers open. The first player or team to buzz claims it, then its instructions are revealed. No points change automatically: edit scores from the host screen as needed. Claimed modifiers stay in the host’s reminders and on the winner’s phone until the host dismisses them.

The presenter selects every question from the host board. The chosen tile briefly highlights on both boards before opening, and phones show the selected category and value. Buzzers stay closed during this cue, including for hidden modifiers. A short two-note chime plays from the host when the selection is confirmed. Use its speaker button to mute it. The Presenter display starts muted; click **Enable sound** there to play cues through that screen instead, and mute the host to avoid hearing both. These sound choices last for the current browser tab, and selection sounds work without enabling announcement sounds in Appearance. Motion preferences use a static highlight instead of a pulse. Questions, answers and the final have no countdowns or time limits; the presenter opens/closes buzzers and reveals answers when ready. Older timer settings are ignored. A team can join with one phone under its team name.

Older game files still import their questions, settings and appearance; the former automated modifier rules are no longer used.

## Game files

Each game lives in its own JSON file under **`data/games/`**. The server reads every `.json` file in that directory at startup and saves changes back to the same file. New browser-created games use their room ID as the filename, for example `data/games/90D59B.json`. Set `DATA_DIR` to use a different data root; its game files live in `<DATA_DIR>/games/`.

You can put an exported game JSON directly into this directory and restart the server. It becomes a saved game in that same file. Open `http://localhost:43187` on the server computer and click **Host** to claim a game added this way. Host access remains saved in that browser. Phones join using the LAN address as usual.

To replay a board, open **More → Reset game** on the host page and confirm. It clears all players, scores, played questions, wagers, claimed modifiers and activity, then returns to the lobby. Questions, settings, appearance, room code and host access stay the same. Players join again using the same link. Reset cannot be undone.

To delete a game, open **Game library** and click the trash button beside **Host**, then confirm the game name. This removes its JSON file and ends access for connected players and presenter screens. Only the host can delete a game.

Saved game files contain host/player keys, scores and current progress. Keep them private. To edit or remove a file manually, stop the server first; it loads the updated directory on the next start.

The old combined `data/games.json` is migrated automatically. Existing per-game files take precedence, and the original combined file is kept as `data/games.json.migrated` after a successful migration. Invalid game files are reported and skipped so other games can still load.

## Sample test game

On the first startup with the default data directory, the bundled sample is copied to `data/games/test-game.json` and loads with the other games. Removing that file later does not recreate it. It has two small boards and a final, with pictures, hidden modifiers and Daily Doubles. A portable definition remains in [examples/test-game.json](examples/test-game.json) for creating another copy through **Create game → Import JSON**. The photos are bundled in `public/test-board/`, so the sample works offline. See the [host guide](examples/test-game.md) for the answer map and a suggested playthrough.

## Commands

```sh
npm test                              # Run tests
npm run play                          # Build and run for a game night
npm run build                         # Build
npm start                             # Run the build
PORT=43189 npm run dev                # Use another port
```

Games live in `data/games/`, uploads in `public/media/`. Back up both. JSON imports and exports game definitions; uploaded media stays separate.
