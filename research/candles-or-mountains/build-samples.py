"""Build isolated quiz candidates; never writes to a Dibs game or public media."""
import datetime as dt
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
VIS = Path('/Users/mychkvad/.codex/visualizations/2026/11/06/01a1b2d1-598f-7f41-b283-a3ff193810be/candles-or-mountains.html')

def resample(points, count=144):
    result = []
    j = 0
    for i in range(count):
        x = points[0][0] + (points[-1][0] - points[0][0]) * i / (count - 1)
        while j + 1 < len(points) - 1 and points[j + 1][0] < x:
            j += 1
        a, b = points[j], points[j + 1]
        t = (x - a[0]) / (b[0] - a[0])
        result.append(a[1] + t * (b[1] - a[1]))
    lo, hi = min(result), max(result)
    return [round((v - lo) / (hi - lo), 5) for v in result]

def market(filename):
    rows = json.loads((ROOT / filename).read_text())
    assert len(rows) > 100
    assert all(rows[i][0] < rows[i+1][0] for i in range(len(rows)-1))
    return resample([(r[0], float(r[4])) for r in rows])

def skyline(filename, left, right):
    im = Image.open(ROOT / filename).convert('RGB')
    points = []
    for x in range(left, right):
        def sky(y):
            r, g, b = im.getpixel((x, y))
            return b > 90 and r < .66 * b and g < .86 * b
        boundary = next((y for y in range(15, im.height-4)
                         if all(not sky(y+k) for k in range(4))), None)
        assert boundary is not None
        points.append((x, -boundary))
    return resample(points)

def trace(points):
    # Hand-traced against the inspected photograph: no cloud/shadow edges.
    return resample([(x, -y) for x, y in points])

commons = 'https://commons.wikimedia.org/wiki/File:Matterhorn_vom_Gornergrat.jpg'
license_url = 'https://creativecommons.org/licenses/by-sa/4.0/'
samples = [
    dict(id=1, kind='market', title='Bitcoin · сентябрь 2017 — март 2018',
         detail='BTC/USDT, дневные цены закрытия Binance. Взлёт конца 2017 года и последующее снижение.',
         source='https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=1504224000000&endTime=1522540799999&limit=1000',
         credit='Binance · исторические дневные свечи; показана линия закрытия.',
         values=market('btc-2017.json')),
    dict(id=2, kind='mountain', title='Маттерхорн · Швейцарские Альпы',
         detail='Приблизительно обведённый контур Маттерхорна на фотографии с Горнерграта.',
         source=commons, credit='Hansueli Krapf / Wikimedia Commons · CC BY-SA 4.0. Производная: выделение и нормализация контура.',
         license=license_url, values=trace([(726,102),(735,100),(743,102),(751,100),(758,96),(762,90),(766,86),(770,78),(773,73),(776,70),(778,64),(780,60),(782,66),(785,65),(787,73),(790,78),(794,83),(798,88),(803,91),(807,94),(814,96),(820,98),(827,100),(836,103)])),
    dict(id=3, kind='market', title='Bitcoin · 2021 год',
         detail='BTC/USDT, дневные цены закрытия Binance. Два крупных подъёма за один год.',
         source='https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=1609459200000&endTime=1640995199000&limit=1000',
         credit='Binance · исторические дневные свечи; показана линия закрытия.',
         values=market('btc-binance.json')),
    dict(id=4, kind='mountain', title='Альпийская гряда · вид с Горнерграта',
         detail='Приблизительно обведённый контур соседних вершин в левой части альпийской панорамы.',
         source=commons, credit='Hansueli Krapf / Wikimedia Commons · CC BY-SA 4.0. Производная: выделение и нормализация контура.',
         license=license_url, values=trace([(18,72),(28,69),(38,66),(49,62),(57,59),(65,62),(73,63),(79,59),(85,63),(93,67),(103,67),(111,73),(121,76),(131,78),(143,77),(155,78),(164,70),(173,63),(180,58),(190,57),(201,52),(211,53),(221,59),(229,64),(240,66),(252,68),(264,70),(275,72),(286,71),(295,65),(302,60),(310,68),(316,68),(322,60),(329,61),(338,68),(347,73),(353,59),(362,56),(370,56),(378,51),(386,48),(392,49),(398,46),(408,50),(417,47),(428,49),(438,46),(449,46),(459,53),(467,50),(476,52),(484,48),(492,48),(501,55),(507,66),(515,71),(526,72),(536,81),(546,75),(558,82)])),
    dict(id=5, kind='market', title='Ethereum · январь — июнь 2021',
         detail='ETH/USDT, дневные цены закрытия Binance. Весенний подъём и снижение после майского пика.',
         source='https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1d&startTime=1609459200000&endTime=1625097599999&limit=1000',
         credit='Binance · исторические дневные свечи; показана линия закрытия.',
         values=market('eth-2021.json')),
    dict(id=6, kind='mountain', title='Фудзи · Япония',
         detail='Контур вершины из фотографии. Широкая вершина похожа на ценовое плато.',
         source='https://www.usgs.gov/media/images/mount-fuji',
         credit='DoctorJoeE / Wikimedia Commons, через USGS · CC BY-SA 4.0. Производная: выделение и нормализация контура.',
         license=license_url, values=skyline('fuji.jpg', 250, 1150)),
]

def path(values, width=1000, height=420, pad=40):
    return ' '.join(('M' if i == 0 else 'L') + f'{pad+(width-2*pad)*i/(len(values)-1):.2f},{height-pad-(height-2*pad)*v:.2f}' for i,v in enumerate(values))

for s in samples:
    d=path(s['values'])
    # Neutral filenames and metadata keep the answer out of the player image.
    (ROOT / f"question-{s['id']:02d}.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 420"><title>Свечи или горы? Вопрос {s["id"]}</title><rect width="1000" height="420" fill="white"/><path d="{d}" fill="none" stroke="#202329" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/></svg>')

(ROOT/'samples.json').write_text(json.dumps(samples, ensure_ascii=False, indent=2))
sheet=Image.new('RGB',(1440,1050),'#f7f5f0')
draw=ImageDraw.Draw(sheet)
for index,s in enumerate(samples):
    x0=40+(index%2)*710
    y0=30+(index//2)*340
    draw.text((x0,y0),f"{s['id']:02d}   CHART OR MOUNTAIN?",fill='#444444')
    coords=[(x0+20+630*i/143,y0+270-220*v) for i,v in enumerate(s['values'])]
    draw.line(coords,fill='#202329',width=3,joint='curve')
sheet.save(ROOT/'contact-sheet.png')
template=(ROOT/'preview-template.html').read_text()
VIS.write_text(template.replace('/*SAMPLES*/[]',json.dumps(samples,ensure_ascii=False)))
notes=['# Свечи или горы? — шесть кандидатов','',
       'Промпт для всех: «Перед вами график цены или контур гор?»','',
       'Ценовые линии построены из настоящих данных. Альпийские силуэты приблизительно обведены вручную по фотографии; контур Фудзи выделен по цветовой границе. Оси скрыты; оба измерения нормализованы, все линии пересэмплированы в 144 точки без разворота. Это контурная версия категории: на экране линия закрытия, а не прямоугольники японских свечей.','',
       'Файлы question-01.svg … question-06.svg содержат только вопрос. samples.json и этот документ содержат ответы. В игру ничего не добавлено.','']
for s in samples:
    notes += [f"## {s['id']}. {'График' if s['kind']=='market' else 'Горы'} — {s['title']}",s['detail'],f"Источник: {s['source']}",s['credit']]
    if s.get('license'): notes += [f"Лицензия производного контура: {s['license']}"]
    notes += ['']
(ROOT/'README.md').write_text('\n'.join(notes))
print(f'Built {len(samples)} samples and {VIS}')
