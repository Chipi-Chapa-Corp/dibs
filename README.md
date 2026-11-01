# Jeopardy

A local quiz game with phone buzzers, custom rules, and a separate presenter screen.

- Build question boards with Markdown, images, video, and audio.
- Create modifiers: flip scores, steal points, swap places.
- Customize themes, timers, rounds, and scoring.
- Edit as you go. Changes save automatically.

## Run

Node.js 22.12+

```sh
npm install
npm run dev
```

Open [localhost:43187](http://localhost:43187). Players join using the LAN address printed in the terminal, on the same Wi-Fi. Open **Presenter** on your second screen.

## Commands

```sh
npm test                              # Run tests
npm run build                         # Build
npm start                             # Run the build
PORT=43189 npm run dev                # Use another port
```

Games live in `data/`, uploads in `public/media/`. Back up both. JSON imports and exports game definitions; uploaded media stays separate.
