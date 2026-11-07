# Quiz screenshot restoration

User preference established 2026-11-05: restore future video screenshots supplied for game questions before adding them to the game.

- Preserve the original visual clue and its meaning; keep answers out of the image.
- Remove video frames, colored strips, overlays, and compression artifacts.
- Reconstruct accidentally cropped object edges and leave comfortable margins.
- Improve clarity and resolution for the presenter screen, retaining the original composition and subject.
- Resolution preference: 720p–1080p is sufficient; do not request or generate 4K images. Preserve a suitable aspect ratio for the clue rather than forcing a 16:9 crop.
- Use the built-in image generation tool for restoration. Inspect the result before installing it.
- Keep source images and create a new restored version. Update the existing question without changing its answer, point value, or other game content.
- Use the app's editor lock and save/upload API. Save restored assets under ignored public/media/; keep preparation notes and local restoration copies under ignored research/.

## Макакао

- Game: Это моя игра (95AF7D).
- Round 1 → Шлакоблокунь → 400 (originally 500; reranked with the expanded category); expected answer: макакао.
- Tool: built-in image_gen, edit of the supplied screenshot.
- Restored local copy: research/restored-images/makakao-restored-v2.png.

Final restoration prompt:

Use case: precise-object-edit. Asset type: high-resolution picture-rebus clue for a quiz game. Input image 1 is the EDIT TARGET, not a loose style reference. Restore this exact macaque + cocoa visual pun while preserving the same macaque face, expression, forward-facing gaze, proportions, head emerging through whipped cream, brown cocoa in a transparent glass mug, faint paws visible through the cocoa, large clear handle on the left, photographic collage appearance, and pure white background. Remove EVERY purple/orange video-frame strip and edge artifact. Extend/reconstruct the cropped bottom so the entire glass mug and its complete thick glass base are visible, with comfortable white margin on all four sides and above the head. Center the full subject on a clean white landscape canvas. Improve resolution, natural fine fur detail, glass clarity and clean edges; reduce video compression/blur without changing the identity or the visual joke. Keep the original warm beige fur and brown drink colors and the same viewing angle. No text, letters, answer, labels, logo, watermark, colored border, frame, extra objects or decorative elements. The final image must look like a faithful cleaned and completed version of this exact screenshot, ready for full-screen projection.

Installed media URL: /media/b3190600cab471f48f88b91e7d5bd83fb5b698c2eaef013a.png

## Seven additional clues · 2026-11-05

Restored using the built-in image_gen tool, one edit per supplied screenshot. Originals are preserved under research/source-images/; restored project copies are under research/restored-images/. Exact prompts are saved in shlakoblokun-restoration-prompts.json; local paths, source generation paths and installed media URLs are in shlakoblokun-assets.json in that directory. Images use approximately 1080p-class resolution, not 4K.

The user authorized ranking all eight questions from easiest to hardest and moving макакао within that ranking. Round 1 → Шлакоблокунь now contains:

| Points | Answer |
| --- | --- |
| 100 | жабаунти |
| 200 | крабрикос |
| 300 | крысало |
| 400 | макакао |
| 500 | комаркер |
| 600 | пудельфин |
| 700 | джинитки |
| 800 | жемчугорь |

All eight use free responses and slow image reveal. Макакао retains its original question ID, image URL and answer. Saved with the app's editing lock and Socket.IO save command; all eight media URLs verified reachable. Before/after game exports are preserved alongside the restored images.

## Minecraft screenshots · 2026-11-05

Restored four user-supplied screenshots using built-in image_gen, removing cyan video frames and improving clarity while preserving Minecraft geometry, composition and landmarks. Originals are in research/source-images/{paris,washington,san-francisco,berlin}.png. Final images are in research/minecraft-images/ with the corresponding -restored.png suffix. The exact prompts, original generation paths and installed URLs are saved in research/minecraft-images/four-city-restorations.json.

Per the user's request, removed New York and Dubai from Майнкрафтляндия without deleting original media. Prague is 100, London 200, Paris 300, Sydney 400, Rome 500, Rio de Janeiro 600, San Francisco 700, Washington 800, Berlin 900. All nine retain free responses and slow reveal. Before/after exports are saved in research/minecraft-images/game-{before,after}-four-city-additions.json. Existing retained question content and other categories were verified unchanged apart from the reordered point values; all image URLs verified reachable and four new uploads matched source hashes.
