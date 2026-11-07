import json
from pathlib import Path
import prepare

prepare.ROOT = Path(__file__).resolve().parent / 'replacements'
prepare.ROOT.mkdir(exist_ok=True)
entries = [
    dict(answer='Гитара', files=['Arpegio DoM Guitarra.ogg'], author='Alejandro Galdámez', license='CC BY-SA 4.0', licenseUrl='https://creativecommons.org/licenses/by-sa/4.0/', accepted='гитара; акустическая гитара; классическая гитара'),
    dict(answer='Пианино', files=['Piano.ogg'], preferPlayback=True, author='Автор не указан; загружено Loveless из французской Википедии', license='CC BY-SA 3.0', licenseUrl='https://creativecommons.org/licenses/by-sa/3.0/', accepted='пианино; фортепиано; рояль'),
]
assets = [prepare.prepare(pair) for pair in enumerate(entries)]
(prepare.ROOT/'assets.json').write_text(json.dumps(assets,ensure_ascii=False,indent=2)+'\n')
