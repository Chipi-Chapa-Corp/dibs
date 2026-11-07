import collections
import html
import json
from pathlib import Path

root = Path(__file__).parent
source = json.loads((root / 'svoyak-categories.json').read_text())
unique = collections.OrderedDict()
for episode in source['episodes']:
    for category in episode['categories']:
        unique.setdefault(category['name'], []).append({**category, 'episode': episode['episode']})
indexed = {i: rows for i, rows in enumerate(unique.values(), 1)}
excluded = {
    37: 'Уже есть: Майнкрафтляндия.',
    90: 'Уже есть: Шлакоблокунь.',
    140: 'Уже есть: Кинопейнт.',
    180: 'Спортивная тема близка к уже имеющемуся «Джим»; исключена для разнообразия.',
    92: 'Рулетка уже есть в «Казино».',
    205: 'Рулетка уже есть в «Казино».',
    306: 'Рулетка уже есть в «Казино».',
    333: 'Рулетка уже есть в «Казино».',
    132: 'Вариант уже имеющейся механики «Шлакоблокунь».',
    156: 'Вариант уже имеющейся механики «Шлакоблокунь».',
}

# Editorial order for this particular group, not measured audience ratings.
order = [int(x) for x in '''
55 284 336 155 216 111 35 54 81 74
335 229 311 323 112 17 64 107 101 211
148 253 271 109 114 267 269 145 332 162
69 199 280 95 337 170 179 19 302 12
133 89 94 106 165 75 34 305 123 102
293 171 217 44 97 277 70 130 117 221
120 261 295 186 150 301 157 168 192 13 151 256
82 46 76 172 233 182 169 93 195 137
98 41 72 65 11 326 115 110 2 3
10 161 203 317 36 250 58 121 85 175
167 248 286 30 27 113 124 274 226 25 56
154 236 185 143 289 189 204 294 213 272 223
127 138 42 49 224 303 304 231 318 308
193 255 122 174 176 196 322 260 238 119
270 28 166 141 187 129 278 164 139 61 62 77 234
331 262 136 209 212 237 108 32 338 5
39 18 297 88 103 210 225 125 87 8
16 22 91 33 247 264 283 214 21 244
314 4 263 334 20 197 83 230 242 288
307 279 177 321 128 273 245 340 227
'''.split()]

# Remaining middle / lower recommendations are added explicitly below.
tail = [int(x) for x in '''
96 228 183 184 339 218 134 48 79 38 181
15 105 99 201 6 190 100 23 198 118 249
240 251 281 316 287 31 291 14 268 71
246 149 215 47 241 86 147 191 78 254
222 327 275 320 312 296 266 298 220 325
319 126 80 66 329 290 265 7 144 116
43 50 51 315 26 208 285 300 313 252
309 243 200 163 276 173 188 310 324 153 9 259
257 52 178 232 202 67 84 57 53 1
292 206 104 194 239 299 60 328 207 59
159 160 63 40 330 146 152 24 235 45 219 135
158 68 258 282 142 29 73 131
'''.split()]
# One repeated planning ID is removed without changing its earlier position.
order = list(dict.fromkeys(order + tail))
assert not set(order) & excluded.keys()
missing = set(indexed) - set(excluded) - set(order)
assert not missing, [(i, indexed[i][0]['name']) for i in sorted(missing)]
assert len(order) == 330

reasons = {
55: 'Сначала все уверены, что знают мем; скрытая деталь заставляет спорить и вспоминать вместе.',
284: 'Узнавание превращается в озвучивание: смешно и отвечающей команде, и зрителям.',
336: 'Пауза перед развязкой и общий просмотр дают естественный момент напряжения и смеха.',
155: 'Неудачный торт смешит ещё до ответа; узнавание персонажа даёт приятную развязку.',
216: 'Знакомый персонаж в неожиданном языке IKEA: больше догадки, меньше сухой эрудиции.',
111: 'Ложная уверенность и спор между командами; особенно хорошо на всем знакомых образах.',
35: 'Плохой перевод знакомого товара даёт абсурд и решаемую загадку.',
54: 'Тот же сильный формат плохого перевода; выбирать вместе с «Всратой темой» не стоит.',
81: 'Общая интернет-память и радость узнавания; выбирать мемы, которые ваша компания действительно застала.',
74: 'Все знают начало мема, но точное продолжение вспоминается не сразу.',
335: 'Знакомая музыка звучит нелепо; после ответа удобно включить оригинал для развязки.',
229: 'Тот же формат обратной записи, что «АПОЖ»; для поля достаточно одной из двух.',
311: 'Игровое звучание и знакомые песни хорошо дополняют вашу Minecraft-тему без повторения её механики.',
323: 'Короткий фрагмент даёт азарт быстрого узнавания и повод требовать «ещё одну секунду».',
112: 'Контраст сухого пересказа и знакомой песни делает сам вопрос шуткой.',
17: 'Узнаваемая эстетика семейных чатов; можно смеяться над картинкой, даже не зная ответа.',
64: 'Сильный визуальный формат, но близок к «WhatsApp-атаке»: выбирайте один.',
107: 'Нелепая логика цитат стимулирует смешные версии даже до правильного ответа.',
101: 'Смешная вывеска работает сразу, задача читается без долгих правил.',
211: 'Неудачный дизайн даёт смешные неправильные прочтения. Близко к другим темам про вывески.',
148: 'Ещё одна версия смешного чтения надписей; не ставить рядом с «Я дизайнер».',
253: 'Та же привлекательная механика чтения странного текста; достаточно одной темы такого типа.',
271: 'Сильные визуальные шутки, но конкурирует с уже перечисленными вывесками.',
109: 'Смешанные лица вызывают узнавание и ошибочную уверенность без необходимости знать биографии.',
114: 'Странный рисунок развлекает сам по себе, а ответ можно вывести по деталям.',
267: 'Абсурдный интернет-ролик и неожиданное продолжение; эффект сильно зависит от выбранного видео.',
269: 'Еда из знакомых мультфильмов даёт ностальгию и узнавание без пересказа сюжета.',
145: 'Знакомые «Смешарики» плюс отсылка, которую команды могут раскусить вместе.',
332: 'Узнаваемая пародия позволяет догадаться даже тем, кто не помнит конкретную серию.',
162: 'Контраст детского мультфильма и уголовного пересказа делает вопрос развлечением.',
69: 'Намеренно плохой пересказ превращает известное кино в смешную загадку.',
199: 'Близко к «Неинтересному пересказу»: отличный формат, но выбирать одну тему.',
280: 'Узнавание по минимуму деталей даёт хороший совместный поиск.',
95: 'Неожиданный визуальный стиль и знакомые фильмы; рядом с «Кинопейнтом» может быть многовато кино.',
337: 'Знакомые сказки в LEGO работают как самостоятельная визуальная шутка.',
170: 'Сочетание Винни-Пуха и кино даёт смешную картинку и понятную разгадку.',
179: 'Хорошо для мемной компании, но рисованные мемы частично повторяют формат вашего «Кинопейнта».',
19: 'Прямое узнавание мемов — надёжно, но менее неожиданно, чем задания с преобразованием.',
302: 'Разнообразие мемных заданий помогает менять темп; важно не превратить тему в несвязанную солянку.',
12: 'Смешно, если все знают брейнрот; иначе преимущество получат один-два человека.',
133: 'Буквальные картинки музыкальных названий смешны и решаемы через ассоциации.',
89: 'Перевёрнутые слова заставляют узнавать песню необычным способом.',
94: 'Видео с предсказанием даёт общую эмоциональную развязку; по азарту уже близко к «Казино».',
106: 'Предсказание ролика с забором — простой повод для смеха, но немного дублирует азарт «Казино».',
165: 'Напряжение и видеоразвязка сильные; ставки и случайность частично пересекаются с «Казино».',
288: 'Отдельная механика выбора правильной техники, но спортивная тема уже представлена «Джимом».',
321: 'Попадает в интерес к инвестициям; лучше мемные интерпретации, а не проверка терминологии.',
128: 'Хорошо попадает в пражский контекст, но сами факты о пиве не гарантируют смешных вопросов.',
73: 'Эмоция случайности возможна, но игроки ничего не выводят; эту роль у вас уже выполняет «Казино».',
131: 'Угадывание предпочтения ведущего почти не даёт полезного обсуждения или ощущения заслуженного ответа.',
}

def tier(rank):
    if rank <= 40: return 'S · первые кандидаты'
    if rank <= 90: return 'A · сильные варианты'
    if rank <= 180: return 'B · зависит от компании'
    if rank <= 260: return 'C · скорее разнообразие'
    return 'D · ниже для этой компании'

improv = {46,76,172,233,182,169,93,195,137,98,41,72,65,11,326,115,110,256,82,242}
video = {336,267,94,106,165,169}
audio = {335,229,311,323,295,303,304}
rows = []
for rank, ident in enumerate(order, 1):
    appearances = indexed[ident]
    first = appearances[0]
    caveat = ''
    if ident in improv:
        caveat = 'Нужна импровизация/исполнение: может смущать игроков; для некоторых заданий критерий зачёта субъективен.'
    if ident in video: media='Видео'
    elif ident in audio: media='Аудио'
    elif any(s in first['sample'].lower() for s in ['[фото','[изображение','[кадр','[рисунок','[картин','[упаков','[фрагмент','[превью','[ребус','[скрин','[коллаж']): media='Изображение'
    elif ident in improv: media='Участие игроков'
    else: media='По выбранным заданиям'
    if ident in reasons: reason=reasons[ident]
    elif rank<=90: reason='Сильный развлекательный формат; отдача зависит от знакомых именно вашей компании примеров.'
    elif rank<=180: reason='Может хорошо сработать, если все знают исходный материал; иначе часть команд выпадает из обсуждения.'
    elif rank<=260: reason='Полезно для смены темы, но узнавание или факт сами по себе дают меньше юмора и общей реакции.'
    else: reason='Для этой компании ниже: преимущественно обычная эрудиция, узкие отсылки или слабая связь между ответом и развлечением.'
    rows.append({'rank':rank,'name':first['name'],'tier':tier(rank),'description':first['description'],'why':reason,'caveat':caveat,'media':media,'sample':first['sample'],'sources':[{'episode':a['episode'],'round':a['round'],'url':a['url'],'time':a['time']} for a in appearances]})

data={
    'title':'СВОЯК: рейтинг категорий для вашей компании',
    'ranked_on':'2026-11-06',
    'methodology':[
        'Субъективный редакторский рейтинг для русскоязычной Gen Z компании в Праге: Россия, Беларусь, Казахстан; интересы — мемы, игры, спорт, инвестиции.',
        'Выше: смех ещё до ответа, участие всей комнаты, неожиданная развязка, узнаваемый общий культурный фон. Ниже: узкие знания одного фандома, сухая эрудиция, чистая случайность и произвольный зачёт ведущим.',
        'Это оценка потенциала формата по уже собранному каталогу и примерам, а не замер реакции зрителей и не новый полный просмотр всех вопросов. Соседние места условны; уровни полезнее разницы в одно место.',
        'В исходном каталоге 362 появления и 340 разных названий. Повторы одного названия объединены с сохранением всех ссылок. Разные названия похожих механик оставлены отдельно: не стоит выбирать сразу несколько таких тем.',
        'Исключено 10 названий: ваши категории и близкие варианты. «Качалка» исключена для тематического разнообразия; «ЕГЭ по физре» оставлена как другая механика с предупреждением о пересечении.',
        'Выпуск №12 с Utopia Show по-прежнему исключён. Данные из прежнего исследования 22 выпусков. ≈ означает неподтверждённое точное написание. Примеры — прежние краткие пересказы, иногда с ответами.',
        'Категории из финалов и бонусов тоже включены. В источнике мог быть сыгран всего один вопрос: полноценную тему из нескольких заданий потребуется подготовить отдельно.',
        'Никакие категории или вопросы в самой игре не добавлены и не изменены. Этот отчёт остаётся в gitignored research/.',
    ],
    'excluded':[{'name':indexed[i][0]['name'],'reason':reason} for i,reason in excluded.items()],
    'recommendation':['Чего-то не хватает','Картинка со звуком','Инструкция IKEA','Тортик, твою мать','АПОЖ','Эффект Манделы'],
    'categories':rows,
}
(root/'svoyak-ranked-categories.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
md=['# '+data['title'],'','Составлено 6 ноября 2026. **330 категорий, от наиболее к наименее перспективным для вашей компании.**','']
md += [f'- {m}' for m in data['methodology']]
md += ['','## Исключено','']+[f"- **{r['name']}** — {r['reason']}" for r in data['excluded']]
for row in rows:
    md += ['',f"## {row['rank']}. {row['name']} — {row['tier']}",'',row['description'],'',row['why']]
    if row['caveat']: md += ['',row['caveat']]
    md += ['',f"Пример: {row['sample']}",'', ' · '.join(f"[Выпуск {s['episode']}, {s['time']}]({s['url']})" for s in row['sources'])]
(root/'svoyak-ranked-categories.md').write_text('\n'.join(md)+'\n')

page='''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>СВОЯК — рейтинг категорий</title>
<style>
:root{font:16px/1.55 system-ui,sans-serif;color:#242620;background:#f1eee5}body{max-width:1450px;margin:auto;padding:28px}h1{font-size:clamp(28px,4vw,46px);line-height:1.15}a{color:#9c351b;text-underline-offset:3px}p{max-width:1050px}.note{background:#e5e4d9;padding:18px;border-left:4px solid #b4472d}.tools{position:sticky;top:0;display:flex;gap:10px;flex-wrap:wrap;padding:14px 0;background:#f1eee5;z-index:1}input,select{font:inherit;padding:11px;background:#fffdf6;color:inherit;border:1px solid #a8ac9f;border-radius:5px}input{flex:1;min-width:220px}table{border-collapse:collapse;width:100%;background:#fffdf7}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #d9d9ce;padding:15px}th{background:#deded1}td:first-child{width:48px;font-size:22px;font-weight:700}td:nth-child(2){width:23%}.badge{font-size:12px;color:#626658}.why{color:#555b4d}.caveat{color:#984126;font-size:14px}details{margin:12px 0}summary{cursor:pointer}.sample{font-size:14px;background:#f1eee5;padding:12px}.sources{font-size:13px;margin-top:10px}#count{color:#626658}label{display:flex;align-items:center;gap:7px}label input{flex:none;min-width:0} @media(max-width:760px){body{padding:16px}.tools{position:static}thead{display:none}table,tbody,tr,td{display:block}tr{border-bottom:2px solid #c8cbbf;padding:10px 0}td{border:0;padding:5px 12px}td:first-child,td:nth-child(2){width:auto}td:nth-child(2) strong{font-size:21px}}
</style>
<link rel="stylesheet" href="svoyak-viewed.css">
<script src="svoyak-viewed.js"></script>
<h1>СВОЯК: что будет веселее именно вам</h1>
<p><b>330 категорий — от наиболее к наименее перспективным.</b> 6 ноября 2026 · 22 выпуска · Utopia Show исключён.</p>
<p class="note">Это субъективная оценка для вашей компании: мемы, общее узнавание, обсуждение и эффектная развязка выше сухой эрудиции. Низкое место не означает плохую категорию. Конкретный подбор вопросов важнее разницы в несколько мест.</p>
<p><b>Мой следующий набор:</b> «Чего-то не хватает», «Картинка со звуком», «Инструкция IKEA», «Тортик, твою мать», «АПОЖ», «Эффект Манделы». Они добавят другие способы играть к уже имеющимся темам.</p>
<details><summary>Что исключено и как составлен рейтинг</summary><div id="method"></div><ul id="excluded"></ul></details>
<p><a href="svoyak-categories.html">Исходный каталог</a> · <a href="svoyak-ranked-categories.md">Markdown</a> · <a href="svoyak-ranked-categories.json">JSON</a></p>
<div class="tools"><input type="search" id="search" placeholder="Найти категорию или механику" aria-label="Поиск"><select id="tier" aria-label="Уровень"><option value="">Все уровни</option><option value="S">S · первые кандидаты</option><option value="A">A · сильные</option><option value="B">B · зависит от компании</option><option value="C">C · разнообразие</option><option value="D">D · ниже для вас</option></select><label><input type="checkbox" id="objective">Без заданий на исполнение</label></div>
<p id="count" aria-live="polite"></p><p class="meta" id="viewed-storage-notice" role="status" hidden>Браузер не разрешает сохранять отметки. Они сохранятся только до обновления страницы.</p><table><thead><tr><th>№</th><th>Категория</th><th>Что делать</th><th>Почему здесь</th><th class="viewed-heading" scope="col">Viewed</th></tr></thead><tbody id="rows"></tbody></table>
<script id="data" type="application/json">DATA_HERE</script>
<script>
const d=JSON.parse(document.getElementById('data').textContent),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),norm=s=>s.toLowerCase().replaceAll('ё','е');
document.getElementById('method').innerHTML=d.methodology.map(m=>'<p>'+esc(m)+'</p>').join('');
document.getElementById('excluded').innerHTML=d.excluded.map(e=>'<li><b>'+esc(e.name)+'</b> — '+esc(e.reason)+'</li>').join('');
const search=document.getElementById('search'),tier=document.getElementById('tier'),objective=document.getElementById('objective');
function render(){const q=norm(search.value.trim()),list=d.categories.filter(c=>(!q||norm(c.name+' '+c.description+' '+c.why).includes(q))&&(!tier.value||c.tier.startsWith(tier.value))&&(!objective.checked||!c.caveat.includes('импровизация')));document.getElementById('count').textContent='Показано '+list.length+' из '+d.categories.length+' · исходные места сохраняются';document.getElementById('rows').innerHTML=list.map(c=>'<tr><td>'+c.rank+'</td><td><strong>'+esc(c.name)+'</strong><br><span class="badge">'+esc(c.tier)+' · '+esc(c.media)+'</span></td><td>'+esc(c.description)+'<details><summary>Пример и источники · могут быть ответы</summary><div class="sample">'+esc(c.sample)+'</div><div class="sources">'+c.sources.map(s=>'<a target="_blank" rel="noopener" href="'+esc(s.url)+'">Выпуск '+s.episode+' · '+esc(s.time)+'</a>').join(' · ')+'</div></details></td><td class="why">'+esc(c.why)+(c.caveat?'<p class="caveat">'+esc(c.caveat)+'</p>':'')+'</td>'+svoyakViewed.cell(c.name)+'</tr>').join('');}
search.addEventListener('input',render);tier.addEventListener('change',render);objective.addEventListener('change',render);render();
</script></html>'''
page=page.replace('DATA_HERE',json.dumps(data,ensure_ascii=False).replace('<','\\u003c'))
(root/'svoyak-ranked-categories.html').write_text(page)
print(json.dumps({'ranked':len(rows),'excluded':len(excluded),'top10':[r['name'] for r in rows[:10]]},ensure_ascii=False,indent=2))
