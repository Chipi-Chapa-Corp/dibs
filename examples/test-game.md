# Quick playtest

The installed copy loads automatically from `data/games/test-game.json`. Open the games list on `http://localhost:43187` and click **Host** to start using it.

To create another copy, import [test-game.json](test-game.json) from **All games → Create game → Import JSON**, then click **Create game**. The import creates a new game. Your existing game is not replaced. Join with 2–3 phones, one per team, and open the Presenter screen.

The sample has two boards of three categories × two cells, plus one final question: **13 cells total**, including **three picture questions, two Daily Doubles and four hidden modifiers**. Teams start with **0 points**. Automatic buzzers are on. Questions, answers and the final have no time limits; the presenter controls the pace. Expect roughly 15–20 minutes including setup.

The three fetched random photos are saved in `public/test-board/` and referenced through `/test-board/…`. They work offline in this project. If you move the JSON to another installation, copy that image folder into its `public/` directory too. A production build includes the photos automatically.

## Host-only map

| Round | Category | Value | Contents |
| --- | --- | ---: | --- |
| Warm-up | Picture this | 100 | Photo: white railings |
| Warm-up | Picture this | 200 | Daily Double: 12 × 12 = 144 |
| Warm-up | Fast fingers | 100 | Hexagon: 6 sides |
| Warm-up | Fast fingers | 200 | Hidden modifier: Trading places |
| Warm-up | Wild cards | 100 | 7 × 8 = 56 |
| Warm-up | Wild cards | 200 | Hidden modifier: Close enough, lasting the next two rounds |
| Double take | Picture this | 300 | Photo: 1 person |
| Double take | Picture this | 400 | Photo Daily Double: a beach |
| Double take | Fast fingers | 300 | Number sequence: 32 |
| Double take | Fast fingers | 400 | Hidden modifier: Pickpocket |
| Double take | Wild cards | 300 | Hidden modifier: Sign flip |
| Double take | Wild cards | 400 | 1440 minutes per day |
| The last word | A matter of time | — | Private final: 3600 seconds per hour |

The presenter can open cells in any order; this table is for the host only.

## Suggested playthrough

1. Buzz at the same time on the first picture clue. Judge a correct answer and watch the score update, then select the next question from the host board.
2. On a normal question, judge one team incorrect and let another team buzz. Check the first team stays locked out.
3. Leave the hexagon question open, then try pausing/resuming the game and closing, reopening or resetting buzzers.
4. Open a hidden modifier: neither its name nor effect should be visible to players before the first claim. Buzz at the same time; only one team should win. Apply its instructions manually using the score controls. Undo a score edit if needed.
5. For a Daily Double, choose the wagering team, collect or set its wager, and select **Lock wagers & open question**. Judge that team directly; there is no buzzer race.
6. Keep **Close enough** as a reminder through the next board and final. Its numeric tolerance is explained in each relevant question’s host notes. Dismiss one-time modifiers after applying them.
7. Close and reopen one phone’s tab in the same browser. Its identity, score and modifier reminders should return.
8. Move to the final, collect private wagers and answers, and reveal the answer and check that further answer edits are rejected. Judge each team once and finish to show standings.

## Photo credits

Random photos were fetched through [Lorem Picsum](https://picsum.photos/) and pinned to specific image IDs so the question answers remain stable:

- Picture 1: [Christian Holzinger](https://unsplash.com/photos/lqQlmcPt9Qg), Picsum 521.
- Picture 2: [Austin Ban](https://unsplash.com/photos/XaU08x_MKhM), Picsum 775.
- Picture 3: [Dominik Schröder](https://unsplash.com/photos/9PCmMdc4Crw), Picsum 702.

Original image and download URLs are also recorded in `public/test-board/sources.json`.
