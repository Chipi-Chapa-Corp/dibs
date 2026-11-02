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
npm run dev
```

Open [localhost:43187](http://localhost:43187). Players open the LAN address printed in the terminal on the same Wi-Fi, choose their game from the list and tap **Join**. Invite links and QR codes open this game list; room codes are never shown. Open **Presenter** on your second screen.

## Development reloads

Keep `npm run dev` running while editing. Changes in `server/`, `shared/`, `vite.config.ts`, `tsconfig.json`, or `package.json` restart the server automatically. A restart saves the current game first; host, presenter, and player screens reconnect automatically. Player tokens preserve each player’s identity. Vite refreshes the page after a server restart, so allow pending edits to finish saving.

React and CSS edits in `src/` update through Vite without restarting the game server. Both watchers poll every 200 ms, including when filesystem change notifications are unavailable. Saved games and uploaded media do not trigger restarts.

After updating the dev command itself, stop and start `npm run dev` once to activate it.

## Prepare, then host

Open the home list and choose **Create game** or **Edit**. Anyone on the local network can create, host, copy, export or delete a game; games have no owner, account or host password. Questions, hidden modifiers, appearance and settings are edited on a separate preparation page. Changes save automatically; **Done** waits for pending saves before returning to the list. The server lets one editor change a game at a time. Other editor tabs show disabled fields and become editable automatically when the current editor leaves or disconnects. Starting or deleting a game waits until editing finishes.

When your board is ready, choose **Host**, invite players and start. The host screen contains the board, buzzers, judging, scores and player status. It has no question, appearance or settings editor. **More** contains pause/resume, finish and reset. The host uses on-screen buttons for all game controls.

After a game starts, its definition is locked, including in editor tabs left open elsewhere. Choose **Copy & edit** in the library to prepare a fresh version while keeping the current game's players, scores and results. A reset returns the original to the lobby and allows preparation again.

## Hidden modifiers

In **Edit → Questions**, open a cell and enable **Hidden modifier**. Enter its title and what it does, including any duration (for example, “Approximate answers allowed for the next 3 rounds”). The cell keeps its normal board value.

When selected, the presenter and phones show a mystery modifier with buzzers open. The first player or team to buzz claims it, then its instructions are revealed. No points change automatically: edit scores from the host screen as needed. Claimed modifiers stay in the host’s reminders and on the winner’s phone until the host dismisses them.

The presenter selects every question from the host board. The chosen tile briefly highlights on both boards before opening, and phones show the selected category and value. Buzzers stay closed during this cue, including for hidden modifiers. Motion preferences use a static highlight instead of a pulse. Questions, answers and the final have no countdowns or time limits; the presenter opens/closes buzzers and reveals answers when ready. Older timer settings are ignored. A team can join with one phone under its team name.

Older game files still import their questions, settings and appearance; the former automated modifier rules are no longer used.

## Game files

Each game lives in its own JSON file under **`data/games/`**. The server reads every `.json` file in that directory at startup and saves changes back to the same file. New browser-created games use their room ID as the filename, for example `data/games/90D59B.json`. Set `DATA_DIR` to use a different data root; its game files live in `<DATA_DIR>/games/`.

You can put an exported game JSON directly into this directory and restart the server. It becomes a saved game in that same file. Open Dibs from any device on the local network and click **Host** to play a game added this way. No ownership claim is needed. Phones join from the game list as usual.

To replay a board, open **More → Reset game** on the host page and confirm. It clears all players, scores, played questions, wagers, claimed modifiers and activity, then returns to the lobby. Questions, settings and appearance stay the same. Players join again from the local game list. Reset cannot be undone.

To delete a game, open the home list and click the trash button beside **Edit**, then confirm the game name. This removes its JSON file and ends access for connected players and presenter screens. Anyone can delete a game when it is not being edited.

Saved game files contain player tokens, scores and current progress. Player tokens identify buzzes and answers; they are not accounts or host permissions. To edit or remove a file manually, stop the server first; it loads the updated directory on the next start.

The old combined `data/games.json` is migrated automatically. Existing per-game files take precedence, and the original combined file is kept as `data/games.json.migrated` after a successful migration. Invalid game files are reported and skipped so other games can still load.

## Sample test game

On the first startup with the default data directory, the bundled sample is copied to `data/games/test-game.json` and loads with the other games. Removing that file later does not recreate it. It has two small boards and a final, with pictures, hidden modifiers and Daily Doubles. A portable definition remains in [examples/test-game.json](examples/test-game.json) for creating another copy through **Create game → Import JSON**. The photos are bundled in `public/test-board/`, so the sample works offline. See the [host guide](examples/test-game.md) for the answer map and a suggested playthrough.

## Commands

```sh
npm test                              # Run tests
npm run build                         # Build
npm start                             # Run the build
PORT=43189 npm run dev                # Use another port
```

Games live in `data/games/`, uploads in `public/media/`. Back up both. JSON imports and exports game definitions; uploaded media stays separate.
