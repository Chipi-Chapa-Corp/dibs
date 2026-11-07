import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request
import time
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
ENTRIES = [
    dict(answer='Скрипка', files=['00 Jazz Violin Solo.ogg'], author='VWD', license='Public domain', licenseUrl=None, accepted='скрипка'),
    dict(answer='Саксофон', files=['Afteryouvegone-first8bars.ogg'], author='Julien Grandgagnage', license='CC BY-SA 3.0', licenseUrl='https://creativecommons.org/licenses/by-sa/3.0/', accepted='саксофон; тенор-саксофон'),
    dict(answer='Флейта', files=['Flute 2.ogg'], author='hokuspokus', license='Public domain', licenseUrl=None, accepted='флейта'),
    dict(answer='Труба', files=['05. D5-trumpet.ogg', '06. F5-trumpet.ogg'], author='ПростоУчастник', license='CC0 1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/', accepted='труба'),
    dict(answer='Аккордеон', files=['Accordion registers.ogg'], author='Necz0r', license='Public domain', licenseUrl=None, accepted='аккордеон; баян (по короткому аудио не требовать различать клавишный аккордеон и баян)'),
    dict(answer='Губная гармошка', files=['Harmonica.ogg'], author='mastermesh', license='Public domain', licenseUrl=None, accepted='губная гармошка; гармоника; гармошка'),
    dict(answer='Волынка', files=['Skye Boat Song.ogg'], author='Clan Stewart Pipe Band; Pandora Records', license='CC BY-SA 2.0', licenseUrl='https://creativecommons.org/licenses/by-sa/2.0/', accepted='волынка'),
]

def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode: raise RuntimeError(result.stderr[-2500:])
    return result

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'DibsQuizResearch/1.0'})
    for attempt in range(3):
        try: return urllib.request.urlopen(req, timeout=30).read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 2: raise
            time.sleep(10)

def prepare(pair):
    index, entry = pair
    entry.update(value=(index + 1) * 300, sources=[])
    for part, name in enumerate(entry['files']):
        page = 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(name.replace(' ', '_'), safe=':')
        cached = ROOT / f'source-{index+1}-{part+1}.html'
        html = cached.read_bytes() if cached.exists() else get(page)
        soup = BeautifulSoup(html, 'html.parser')
        media = soup.select_one('.fullMedia a')['href'].split('?')[0]
        # Use the site's smaller MP3 playback copies for the last two clips.
        playback = index >= 5 or entry.get('preferPlayback', False)
        if playback: media = soup.select_one('source[type="audio/mpeg"]')['src']
        extension = '.mp3' if playback else '.ogg'
        original = ROOT / f'original-{index+1}-{part+1}{extension}'
        if not original.exists(): original.write_bytes(get(media))
        (ROOT / f'source-{index+1}-{part+1}.html').write_bytes(html)
        (ROOT / f'source-{index+1}-{part+1}.txt').write_text(soup.select_one('#mw-content-text').get_text(' ', strip=True))
        entry['sources'].append(dict(title=name, page=page, download=media, original=str(original)))
    # Join the two real trumpet notes; every other clip uses one recording.
    args = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error']
    for source in entry['sources']:
        args += ['-i', source['original']]
    raw = ROOT / f'working-{index+1}.wav'
    filters = []
    if len(entry['sources']) == 2:
        filters = ['-filter_complex', '[0:a]aresample=44100,aformat=channel_layouts=mono[a];[1:a]aresample=44100,aformat=channel_layouts=mono[b];[a][b]concat=n=2:v=0:a=1[out]', '-map', '[out]']
    run(args + filters + ['-ac', '1', '-ar', '44100', str(raw)])
    trimmed = ROOT / f'trimmed-{index+1}.wav'
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(raw),'-af','silenceremove=start_periods=1:start_duration=0.03:start_threshold=-48dB,atrim=duration=8,asetpts=PTS-STARTPTS','-ac','1','-ar','44100',str(trimmed)])
    duration = float(run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(trimmed)]).stdout)
    assert 3 < duration <= 8.01
    measure = run(['ffmpeg','-hide_banner','-i',str(trimmed),'-af','loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json','-f','null','-']).stderr
    stats = json.JSONDecoder().raw_decode(measure[measure.rfind('{'):])[0]
    normalization = f"loudnorm=I=-18:TP=-1.5:LRA=11:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true"
    output = ROOT / f'clip-{index+1:02}.mp3'
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(trimmed),'-af',normalization+f',afade=t=in:d=0.015,afade=t=out:st={duration-0.12:.3f}:d=0.12','-ar','44100','-ac','1','-codec:a','libmp3lame','-b:a','160k','-map_metadata','-1','-id3v2_version','0','-write_id3v1','0',str(output)])
    probe = json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(output)]).stdout)
    assert not probe['format'].get('tags')
    assert probe['streams'][0]['codec_name'] == 'mp3'
    assert all(s['codec_type'] == 'audio' for s in probe['streams'])
    entry.update(file=str(output), duration=duration, bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest(), changes='Первые 8 секунд после удаления начальной тишины (или вся запись, если короче); выровнена громкость, короткое плавное начало/окончание, MP3; теги удалены.' if index!=3 else 'Две исходные ноты трубы соединены последовательно; выровнена громкость, короткое плавное начало/окончание, MP3; теги удалены.')
    for path in [raw, trimmed]: path.unlink()
    print(json.dumps(dict(answer=entry['answer'], seconds=round(duration,2), bytes=entry['bytes']), ensure_ascii=False), flush=True)
    return entry

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        assets = list(executor.map(prepare, enumerate(ENTRIES)))
    (ROOT/'assets.json').write_text(json.dumps(assets,ensure_ascii=False,indent=2)+'\n')
