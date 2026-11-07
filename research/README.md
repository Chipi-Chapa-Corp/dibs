# Game research and preparation archive

Published after playing «Это моя игра» on 7 November 2026. These reports and preparation files contain categories, questions and answers, including ideas not used in that game.

## Reports

- [Свояк: category catalogue](svoyak-categories.html) · [Markdown](svoyak-categories.md) · [JSON](svoyak-categories.json)
- [Свояк: ranked categories](svoyak-ranked-categories.html) · [Markdown](svoyak-ranked-categories.md) · [JSON](svoyak-ranked-categories.json)
- [Свояк: modifiers](svoyak-modifiers.html) · [Markdown](svoyak-modifiers.md) · [JSON](svoyak-modifiers.json)
- [Internet party games](internet-party-games.html) · [Markdown](internet-party-games.md) · [JSON](internet-party-games.json)
- [Categories for Gen Z immigrants in Prague](prague-genz-categories.html) · [Markdown](prague-genz-categories.md) · [JSON](prague-genz-categories.json)
- [More party games](more-party-games.html) · [Markdown](more-party-games.md) · [JSON](more-party-games.json)

To use the interactive reports, run this command from the repository root and open http://127.0.0.1:43202/:

```sh
python3 -m http.server 43202 --bind 127.0.0.1 --directory research
```

The **Viewed** checkboxes in the Свояк reports share progress through browser local storage on the same origin. GitHub's file view does not run the interactive HTML.

## Supporting files

Subdirectories retain source images and audio, source links, generated question assets, verification material, and game-definition snapshots from preparation. The build scripts regenerate individual reports or assets. The game-editing scripts are historical helpers targeting the original local game; they are not needed to import or play the published game.

Use [the published game definition](../examples/eto-moya-igra.json) and its [import guide](../examples/eto-moya-igra.md) to play a fresh copy. Live sessions under `data/`, including player credentials and results, remain local.
