"""Apply guest exclusions to the private Svoyak catalog and all its output formats."""
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
EXCLUDED_VIDEO_IDS = {'5RK0YnF2U6s'}
EXCLUDED_GUEST = re.compile(r'utopia|утопи[яи]|\bтопа\b', re.I)


def main():
    catalog_path = ROOT / 'svoyak-categories.json'
    data = json.loads(catalog_path.read_text())
    excluded = [e for e in data['episodes'] if e['youtube_id'] in EXCLUDED_VIDEO_IDS or EXCLUDED_GUEST.search(e['original_title'])]
    data['episodes'] = [e for e in data['episodes'] if e not in excluded]
    previous = data.get('exclusions', {})
    removed_count = sum(len(e['categories']) for e in excluded) or previous.get('category_appearance_count', 0)
    removed_episodes = sorted(set(previous.get('episode_numbers', [])) | {e['episode'] for e in excluded})
    removed_ids = sorted(set(previous.get('youtube_ids', [])) | {e['youtube_id'] for e in excluded})
    data['exclusions'] = dict(guest='Utopia Show', episode_numbers=removed_episodes, youtube_ids=removed_ids, category_appearance_count=removed_count)
    data['updated_on'] = '2026-11-04'
    data['episode_count'] = len(data['episodes'])
    data['category_appearance_count'] = sum(len(e['categories']) for e in data['episodes'])
    data['uncertain_title_count'] = sum(c['title_spelling_uncertain'] for e in data['episodes'] for c in e['categories'])
    note = f"Исключены выпуски с участием Utopia Show: № {', '.join(map(str, removed_episodes))}. Все {removed_count} категорий и примеров вопросов из этих выпусков удалены. Фильтр обновлён 4 ноября 2026."
    notes = [n for n in data['methodology'] if not n.startswith('Исключены выпуски')]
    notes[0] = f"Каталог {data['episode_count']} из 23 найденных на канале выпусков «СВОЯК» от 11 мая 2025 до 31 октября 2026; расшифровки проверены 3 ноября 2026."
    notes[1] = re.sub(r'^\d+ появлений', f"{data['category_appearance_count']} появлений", notes[1])
    notes = [re.sub(r'Знак ≈ у \d+ названий', f"Знак ≈ у {data['uncertain_title_count']} названий", n) for n in notes]
    notes.insert(1, note)
    data['methodology'] = notes
    catalog_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

    md = ['# СВОЯК — каталог сыгранных категорий', '']
    md.extend(n + '\n' for n in notes)
    md.extend(['Источник списка выпусков: [видео канала Коваля](https://www.youtube.com/@etokoval/videos). Ссылки с таймкодами приведены рядом с примерами.', '', '## Выпуски', '', '| № | Дата | Участники / выпуск | Категорий |', '|---|---|---|---|'])
    for e in data['episodes']:
        md.append(f"| {e['episode']} | {e['date']} | [{e['title'].replace('|', ' · ')}](#выпуск-{e['episode']}) | {len(e['categories'])} |")
    for e in data['episodes']:
        md.extend(['', f'<a id="выпуск-{e["episode"]}"></a>', f"## Выпуск {e['episode']}. {e['title'].replace('|', ' · ')}", '', f"{e['date']} · [Смотреть выпуск]({e['url']})", ''])
        if e['note']:
            md.extend([e['note'], ''])
        for round_ in dict.fromkeys(c['round'] for c in e['categories']):
            label = 'Раунд ' + round_ if round_.isdigit() else round_
            md.extend([f'### {label}', '', '| Категория | Что нужно делать | Пример сыгранного задания |', '|---|---|---|'])
            for c in e['categories']:
                if c['round'] == round_:
                    md.append(f"| {c['name']} | {c['description']} | {c['sample']} [↗ {c['time']}]({c['url']}) |")
    (ROOT / 'svoyak-categories.md').write_text('\n'.join(md) + '\n')

    page_path = ROOT / 'svoyak-categories.html'
    page = page_path.read_text()
    payload = json.dumps(data, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    pattern = r'(<script id="catalog-data" type="application/json">).*?(</script>)'
    page, replacements = re.subn(pattern, lambda m: m[1] + payload + m[2], page, flags=re.S)
    assert replacements == 1
    page = re.sub(r'<p class="meta" id="guest-exclusion">.*?</p>\n?', '', page)
    marker = '<p class="meta" id="total"></p>'
    assert marker in page
    page = page.replace(marker, marker + '\n<p class="meta" id="guest-exclusion">' + html.escape(note) + '</p>')
    page_path.write_text(page)
    print(json.dumps({k: data[k] for k in ['episode_count', 'category_appearance_count', 'uncertain_title_count', 'exclusions']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
