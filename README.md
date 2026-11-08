# Dibs

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

Use `npm run play` for game nights. Use `npm run dev` during development for hot reload.

Open [localhost:43187](http://localhost:43187). Players open the LAN address printed in the terminal on the same Wi-Fi, choose their game from the list and tap **Join**. The host creates teams before starting. Players enter their own name and select one of these teams; they cannot create teams. Each player can use their own phone as a buzzer; teammates share their score, readiness, wagers and buzz lockouts. Invite links and QR codes open this game list; room codes are never shown. Open **Presenter** on your second screen. During play, phones show only scores and the circular buzzer. Teams speak their choices and answers to the presenter, who records them on the host screen.

## Local network security

The server accepts HTTP and Socket.IO connections from loopback and the subnet of one selected private IPv4 LAN interface. It prefers `en0`, otherwise the first physical private IPv4 interface, excluding common VPN/container interfaces. Set `LAN_INTERFACE=en0` (or your interface name) to select one explicitly. Without a private LAN interface, only loopback is allowed. Restart after switching networks. IPv6 connections are disabled. Forwarded-IP headers are ignored; this configuration is intended for direct LAN access, not a reverse proxy or public tunnel.

Host-header and browser-Origin checks reject unexpected addresses and cross-origin HTTP/WebSocket requests, including DNS rebinding attempts. Direct navigation to a shared game-list link still works.

Games remain public within the selected LAN: anyone can create, host, edit, copy, export or delete games. There are no host keys or host-transfer links. One-editor-at-a-time locks prevent simultaneous edits. Individual player tokens preserve reconnects; teammates have different credentials. These network protections do not make untrusted LAN participants safe to invite.

Limits per server: **100 games**, **1 GiB uploaded media** (including existing files), **100 MiB per file**, and one file per upload. Limits apply while streaming, including simultaneous/chunked uploads; failed or oversized uploads are removed. Existing files above the cap are preserved, and further uploads are rejected. Remove unused media while the server is stopped and restart to recalculate capacity.

Per source IP: **300 API requests/minute**, **120 join requests/minute**, **20 new games/hour**, **10 uploads/minute**, and **60 Socket.IO handshakes/minute**. Socket.IO allows 128 simultaneous engine connections, and a socket sending over 60 actions/second is disconnected. Rate limits reset on server restart. These limits reduce abuse; they do not provide protection against a large network denial-of-service attack.

On macOS, run `npm run firewall:enable` in your terminal. The helper asks macOS for administrator authorization, allows the current Node executable, enables the application firewall, then prints both settings for verification. Repeat after changing the Node installation. It does not enable “block all incoming connections”, which would prevent phones from connecting.

Keep this app on a trusted LAN. HTTP traffic is still unencrypted. Do not configure port forwarding or publish a tunnel; HTTPS and a separate public-hosting security review are required before internet deployment. LAN source checks cannot distinguish a local peer from a proxy that forwards requests on its behalf.

## Development reloads

Keep `npm run dev` running while editing. Changes in `server/`, `shared/`, `vite.config.ts`, `tsconfig.json`, or `package.json` restart the server automatically. A restart saves the current game first; host, presenter, and player screens reconnect automatically. Individual player tokens preserve each player’s identity and team membership. Vite refreshes the page after a server restart, so allow pending edits to finish saving.

React and CSS edits in `src/` update through Vite without restarting the game server. Both watchers poll every 200 ms, including when filesystem change notifications are unavailable. Saved games and uploaded media do not trigger restarts.

After updating the dev command itself, stop and start `npm run dev` once to activate it.

## Prepare, then host

Open the home list and choose **Create game** or **Edit**. Anyone on the local network can create, host, copy, export or delete a game; games have no owner, account or host password. Use **+ Round** to add a board immediately and **+ Final** to add the final question. Rounds are named automatically by position; Final always stays after the boards. Its question and response editor is inline, without a category grid. Questions, hidden modifiers, appearance and settings are edited on a separate preparation page. Changes save automatically; **Done** waits for pending saves before returning to the list. The server lets one editor change a game at a time. Other editor tabs show disabled fields and become editable automatically when the current editor leaves or disconnects. Starting or deleting a game waits until editing finishes.

The library labels each game **Not started**, **Ongoing**, or **Finished** and updates as the host starts, finishes, resumes or resets it. Use the status filter to narrow the list; **All games** includes finished games.

When your board is ready, choose **Host**, use **Add team** to create the teams, invite players and wait for every team to mark itself ready on a phone. **Start game** stays disabled until all teams are ready; this rule is always enforced. Teams cannot be added, renamed or removed once play starts, including while paused, after finishing or through undo. Reset clears teams for a new game. The host screen contains the board, buzzers, judging, scores and team status. It has no question, appearance or settings editor. **Game controls** contains the selection sound toggle, pause/resume, finish and reset. The host uses on-screen buttons for all game controls.

After a game starts, its definition is locked, including in editor tabs left open elsewhere. Choose **Copy & edit** in the library to prepare a fresh version while keeping the current game's teams, scores and results. A reset returns the original to the lobby and allows preparation again.

Round names are automatic: **Round 1**, **Round 2**, **Round 3**, and so on. Moving, duplicating or removing rounds updates their numbers. Imported and saved games use the same numbering.

Each category has its own **+ Question** button and can contain a different number of questions. New categories start empty. Default values increase by 100 in round one, 200 in round two, 300 in round three, and so on, continuing after the highest value in that category. Existing values remain editable. **Delete question** in the question popup removes only that question.

Use the up and down arrows on each question card to reorder questions within its category. Changes save automatically and appear in the same order on the host and presenter boards. Moving a question keeps its point value, answer, media and settings together.

Question cards show rendered text and image previews. Opening a question or Final shows rendered questions, responses and host notes by default. Use the code icon beside a section to edit its Markdown, then the eye icon to return to its preview. Adding an answer opens its input so you can type immediately.

Enable **Slow image reveal · 5 seconds** in a question to uncover its images from top to bottom on the presenter screen. The image keeps its full size while it is revealed; text and answer choices appear normally. Buzzers stay available during the reveal. A team's buzz freezes the image until the presenter judges its answer; the reveal then continues from the same point. Pausing the game also pauses the reveal. The host sees the complete image for judging. The setting and paused progress survive saving and reloading the presenter.

The presenter keeps the category and value in the top bar, the question text above its images, and team scores at the bottom. Images fit the remaining space without pushing scores off-screen when they load. On the host, **Enlarge** opens the clue images in a full-screen overlay on the host screen. **Close** or Escape dismisses it. This is a local host preview and does not change the presenter, slow-reveal progress or buzzing.

In the question popup, **Daily double** uses the same checkbox control as **Show ended**. Enter the question, then choose **Answer**, **Modifier** or **Free Response**. Free Response keeps an expected answer for the host and offers no answer choices to players. Final allows Answer or Free Response. Answers start with two rows; **Add answer** adds more choices, with a radio button marking the correct one. Deleting the correct answer selects the next remaining choice. **Shuffle answers** is on by default and randomizes the shared order when a question opens; turn it off to keep the written order. The Answer / Modifier toolbar also offers media insertion and preview. Choices appear with the question during play, and the correct answer is revealed by the host. Host notes are always visible in the popup.

## Media references

Question prompts, answers and notes store media as Markdown/HTML URLs, for example `![Photo](/media/example.jpg)` and `[Audio](/media/example.mp3)`. Uploaded files live under `public/media/`; bundled sample pictures use `/test-board/...` and live under `public/test-board/`. External HTTP(S) URLs remain external. A background image URL is stored separately as `theme.background`.

Game JSON contains these references, not the media bytes. Moving a game to another server requires copying uploaded files while preserving their paths. Built-in selection and announcement sounds are synthesized with Web Audio; they have no media-file reference. `theme.sound` controls announcement sounds, while screen mute choices live in browser session storage.

## Daily Double: give it to another team

Enable **Daily Double** on a question during preparation. The presenter records each step on the host screen: which team chose the cell, which opponent that team names aloud, and the wager chosen aloud by the receiving team. Team and wager controls appear one step at a time. The room display shows a Daily Double card with the category, team matchup and confirmed wager; opening the question replaces the card with the clue and keeps those details visible. Phones keep the same score and buzzer screen throughout the game. Buzzers stay closed.

The presenter offers wager amounts aloud. The receiving team states its choice and the presenter records it with **Confirm wager**, then selects **Open question**, then judges **Correct** or **Incorrect**. Only the receiving team's score changes; an incorrect answer loses the wager even when normal wrong-answer deductions are disabled. Wagers use whole point amounts from 0 to 10,000,000, independent of current score and the Final wager limit.

On the host screen, **Change** lets the presenter correct earlier choices. Changing teams clears the previous wager. The question and answer are tucked under **Preview question & answer** until the clue opens. Assignment and wager progress survive reload/restart. The final round uses private submissions from team phones, with a host override for paper submissions or connection problems.

## Hidden modifiers

In **Edit → Questions**, open a cell and choose **Modifier** below the question. Enter its title and what it does, including any duration (for example, “Approximate answers allowed for the next 3 rounds”). The cell keeps its normal board value.

When selected, the presenter shows a mystery modifier and the phone buzzers open. The first team to buzz claims it, then its instructions are revealed. No points change automatically: edit scores from the host screen as needed. Claimed modifiers stay in the host’s reminders until the host dismisses them.

For regular questions, the presenter chooses the tile after the team names its choice aloud. The clue opens and buzzers open automatically. The first buzz locks in one answering team and shows **Correct** and **Incorrect** controls on the host screen. Points follow the question value and scoring settings; click any team to open one panel with every team’s score and players. Edit multiple scores and apply them together with **Save scores**; players can be removed without leaving the panel. Correct scores that answer, closes buzzing and animates the answer reveal on the presenter screen. The answer remains visible until the host clicks **Continue**; Continue waits for the reveal to finish before returning to the board. Incorrect deducts the normal penalty and reopens buzzing for the remaining teams. Clicking Incorrect immediately highlights that team in the host’s existing team list with a red border, an × and an Incorrect label. Teams stay in their creation order on the presenter screen as scores change. The presenter scoreboard immediately shows a steady red highlight and keeps the status visible for the whole question, including when scores are hidden. These markers clear for the next question. No team queue is kept, and the picking team is not tracked. **End question** reveals the answer without changing scores, including when no teams remain. The answer stays visible until the host clicks **Continue**. Answers stay private on the host screen until a correct answer or **End question** triggers the reveal.

For the final round, teams enter wagers privately on their phones. Each team has one shared wager and free-text answer; any teammate can edit them. Changes save after a short typing pause and show **Saved** when acknowledged. Wagers must be whole points within the configured limit; zero is allowed, including for teams with zero or negative scores. The host sees all wagers and can select **Lock wagers & open question** after every team has a saved wager. Teams then enter their answers, which remain editable until **Lock answers**. If answers are missing, the host confirms before locking. There are no deadlines.

The host then marks each team **Correct** or **Incorrect**, and can revise either choice. **Host override** allows private entry or correction of a wager and answer, including after locking or judging, for paper submissions and connection problems. Correcting a judged wager recalculates its points without scoring twice. Saved submissions and locks survive refreshes, individual player reconnects and server restarts. Concurrent edits use field versions: a stale phone cannot overwrite a teammate’s saved edit without review. Unsaved edits need a live connection and a **Saved** confirmation before refreshing or closing the page.

Presenter and phones keep showing pre-final scores while the host judges. Other teams receive submission status only, never another team’s wager, answer, grading or score changes; private data is filtered on the server, including history and score snapshots. **Finish game** becomes available after answers are locked and every team is judged. It reveals the final answer and starts the results celebration without returning to the board. Daily Doubles retain their assigned opposing team and wager, and their results can be revised before Continue.

Finishing a final round first shows the final answer for five seconds. A three-second countdown follows, then Presenter and team phones reveal places from last to first, including each team’s answer, wager and result, with a pause before the winner and a short confetti celebration. The final answer remains below the results. Games without a final question start with the countdown. Ties reveal together, while team cards stay in creation order. Refreshing resumes the same reveal; reduced-motion preferences or disabled theme motion show the results immediately. **Skip reveal** shows all results at once.

The presenter selects every question from the host board. The chosen tile briefly highlights on both boards before opening, while phones keep the score and buzzer. Buzzers stay closed during this cue, including for hidden modifiers. A two-note selection chime plays from the host; its speaker button mutes it. The presenter display starts muted and can enable sound separately. Choices last for the browser tab. Motion preferences use a static highlight instead of a pulse. Questions, answers and the final have no countdowns or time limits; regular-question buzzers open automatically and the host judges the first team to buzz. Older timer settings are ignored. Each player joins a host-created team using their own name and phone.

Older game files still import their questions, settings and appearance; the former automated modifier rules are no longer used.

## Game files

Each game lives in its own JSON file under **`data/games/`**. The server reads every `.json` file in that directory at startup and saves changes back to the same file. New browser-created games use their room ID as the filename, for example `data/games/90D59B.json`. Set `DATA_DIR` to use a different data root; its game files live in `<DATA_DIR>/games/`.

You can put an exported game JSON directly into this directory and restart the server. It becomes a saved game in that same file. Open Dibs from any device on the local network and click **Host** to play a game added this way. No ownership claim is needed. Phones join from the game list as usual.

Players can click **Leave game** to remove their own buzzer and return to the join screen. Closing a tab or losing Wi-Fi keeps their membership; reopening the same game at the same address in the same browser reconnects automatically. After clearing browser data or moving to another device, enter your name and choose your team again. The host can select a team to see its named players and connection status, then **Remove player** to revoke only that player's login. A removed player can join again; removal is not a permanent ban. Team scores, wagers, answer attempts and claimed modifiers stay with the team even when nobody is connected.

Older saved games retain their teams, scores and board progress. Existing phones must join once with an individual name because the old login identified the entire team. Player credentials and the fixed team roster persist across server restarts; undo cannot restore a removed player's credential.

To replay a board, click **Reset game** in the center of the host page header and confirm. It clears all teams, players, scores, played questions, wagers, claimed modifiers and activity, then returns to the lobby. Questions, settings and appearance stay the same. Players join again from the local game list. Reset cannot be undone.

To delete a game, open the home list and click the trash button beside **Edit**, then confirm the game name. This removes its JSON file and ends access for connected players and presenter screens. Anyone can delete a game when it is not being edited.

Saved game files contain individual player tokens, team scores and current progress. Player tokens identify a member and their team; they are not accounts or host permissions. To edit or remove a file manually, stop the server first; it loads the updated directory on the next start.

The old combined `data/games.json` is migrated automatically. Existing per-game files take precedence, and the original combined file is kept as `data/games.json.migrated` after a successful migration. Invalid game files are reported and skipped so other games can still load.

## Sample test game

On the first startup with the default data directory, the bundled sample is copied to `data/games/test-game.json` and loads with the other games. Removing that file later does not recreate it. It has two small boards and a final, with pictures, hidden modifiers and Daily Doubles. A portable definition remains in [examples/test-game.json](examples/test-game.json) for creating another copy through **Create game → Import JSON**. The photos are bundled in `public/test-board/`, so the sample works offline. See the [host guide](examples/test-game.md) for the answer map and a suggested playthrough.

## Played game: Это моя игра

The completed Russian-language game is available as [examples/eto-moya-igra.json](examples/eto-moya-igra.json), with its images and audio bundled in `public/played-games/eto-moya-igra/`. Import it through **Create game → Import JSON** to play a fresh copy. See the [game guide](examples/eto-moya-igra.md) for details. Reports, sources and preparation assets are published in [research/](research/README.md). Local saved sessions remain excluded from Git.

## Commands

```sh
npm test                              # Run tests
npm run play                          # Build and run for a game night
npm run build                         # Build
npm start                             # Run the build
PORT=43189 npm run dev                # Use another port
```

Games live in `data/games/`, uploads in `public/media/`. Back up both. JSON imports and exports game definitions; uploaded media stays separate.

### Final category elimination

Prepare up to 20 final categories, each with one free-response question. During the final, teams announce the categories they reject and the host crosses them out. Rejected categories remain visible on the presenter screen and can be restored before wagering starts. Once one category remains, **Collect wagers** opens the existing private phone wager and answer flow. The clue stays hidden until wagers are locked; scores and judgments remain private until the final reveal. Elimination progress survives reconnection and server restarts. A final with one category goes straight to wagers.

By default, every team can wager from zero up to the higher of **1500** or its score at the start of the final, including teams with negative scores. The wager changes the existing score; it does not reset it. The optional unlimited-wager setting is also available.
