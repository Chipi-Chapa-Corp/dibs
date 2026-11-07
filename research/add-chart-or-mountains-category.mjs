import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {io} from 'socket.io-client';

const base = 'http://localhost:43187';
const gameId = '95AF7D';
const directory = 'research/candles-or-mountains';
const categoryName = 'График или горы';
const samples = JSON.parse(await fs.readFile(`${directory}/samples.json`, 'utf8'));
assert.equal(samples.length, 6);
const uid = () => randomUUID().replaceAll('-', '').slice(0, 12);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const images = await Promise.all(samples.map(sample => fs.readFile(`${directory}/question-${String(sample.id).padStart(2, '0')}.png`)));
assert.equal(new Set(images.map(sha256)).size, 6);

const socket = io(base, {transports: ['websocket'], reconnection: false, timeout: 10000});
let state;
socket.on('state', value => { state = value; });
const emit = (event, input) => new Promise((resolve, reject) => {
  socket.timeout(10000).emit(event, input, (error, result) => {
    if (error) reject(error);
    else if (!result?.ok) reject(new Error(result?.error || 'Command failed'));
    else resolve(result);
  });
});
const exportGame = async () => {
  const response = await fetch(`${base}/api/games/${gameId}/export`);
  assert(response.ok, 'Game export failed.');
  return response.json();
};

try {
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  await emit('subscribe', {gameId, role: 'host', editing: true});
  assert.equal(state?.status, 'lobby', 'The game must be in the lobby.');
  assert.equal(state?.editLock, 'mine', 'Another editor holds the editing lock.');
  const before = await exportGame();
  assert.equal(before.name, 'Это моя игра');
  const rounds = structuredClone(before.rounds);
  assert.equal(rounds[2]?.type, 'board');
  assert(rounds[2].categories.length < 10);
  assert(!rounds.some(round => round.categories.some(category => category.name === categoryName)), 'Category already exists.');
  const snapshot = `${directory}/installation-${new Date().toISOString().replaceAll(':', '-')}`;
  await fs.mkdir(snapshot, {recursive: true});
  await fs.writeFile(`${snapshot}/game-before.json`, JSON.stringify(before, null, 2) + '\n');
  const category = {id: uid(), name: categoryName, questions: []};
  const installed = [];
  for (const [index, sample] of samples.entries()) {
    const image = images[index];
    const form = new FormData();
    form.append('file', new Blob([image], {type: 'image/png'}), `outline-${sample.id}.png`);
    const upload = await fetch(`${base}/api/games/${gameId}/media`, {
      method: 'POST', headers: {'X-Editor-Id': socket.id}, body: form,
    });
    const media = await upload.json();
    assert(upload.ok && media.url, media.error || 'Image upload failed.');
    const isMarket = sample.kind === 'market';
    const accepted = isMarket ? 'График; график цены; биржевой график.' : 'Горы; контур гор; горный хребет.';
    const sourceFile = isMarket
      ? {1: 'btc-2017.json', 3: 'btc-binance.json', 5: 'eth-2021.json'}[sample.id]
      : sample.id === 6 ? 'fuji.jpg' : 'matterhorn.jpg';
    const sourceBytes = await fs.readFile(`${directory}/${sourceFile}`);
    const notes = [
      `**Ответ:** ${isMarket ? 'График' : 'Горы'} — ${sample.title}.`,
      `**Засчитывать:** ${accepted} Называть актив или гору не требуется.`,
      sample.detail,
      `**Проверка:** [${isMarket ? 'Исходные дневные свечи Binance (JSON)' : 'Исходная фотография и описание'}](${sample.source}).`,
    ];
    if (isMarket) {
      const rows = JSON.parse(sourceBytes.toString('utf8'));
      const first = new Date(rows[0][0]).toISOString().slice(0, 10);
      const last = new Date(rows.at(-1)[0]).toISOString().slice(0, 10);
      notes.push(`**Данные:** ${sample.id === 5 ? 'ETH/USDT' : 'BTC/USDT'}; ${first} — ${last}, UTC; ${rows.length} дневных свечей. Из каждой свечи взята цена закрытия (элемент 4, нумерация с нуля). Показан линейный график, не тела японских свечей.`);
    } else if (sample.id === 2) {
      notes.push('**Фрагмент:** Маттерхорн в правой части панорамы «Matterhorn vom Gornergrat.jpg», фотография 17.08.2012; приблизительная ручная обводка x=726…836 на копии 960×274 пикселя.');
    } else if (sample.id === 4) {
      notes.push('**Фрагмент:** левая часть той же панорамы «Matterhorn vom Gornergrat.jpg», вид с Горнерграта, 17.08.2012; приблизительная ручная обводка x=18…558 на копии 960×274 пикселя. Отдельные вершины здесь не идентифицируются.');
    } else {
      notes.push('**Фрагмент:** фотография «Mt. Fuji, enhanced», DoctorJoeE; контур выделен по границе неба на участке x=250…1149 копии 1336×615 пикселей.');
    }
    notes.push('**Подготовка:** оси, даты и единицы скрыты. Вертикальный и горизонтальный масштабы нормализованы; контур пересэмплирован в 144 точки без разворота.');
    notes.push(`**Авторство:** ${sample.credit}`);
    if (sample.license) notes.push(`**Лицензия контура:** [CC BY-SA 4.0](${sample.license}).`);
    notes.push(`**Архив для проверки:** ${directory}/${sourceFile}; SHA-256: ${sha256(sourceBytes)}. Метод построения: ${directory}/build-samples.py.`);
    const question = {
      id: uid(), value: (index + 1) * 300,
      prompt: `График цены или контур гор?\n\n![Контур](${media.url})`,
      answer: `${isMarket ? 'График' : 'Горы'} — ${sample.title}`,
      notes: notes.join('\n\n'), responseType: 'free',
      dailyDouble: false, modifier: null, slowReveal: false,
    };
    category.questions.push(question);
    installed.push({sampleId: sample.id, questionId: question.id, value: question.value, answer: question.answer, mediaUrl: media.url, sha256: sha256(image), source: sample.source, sourceFile, sourceSha256: sha256(sourceBytes)});
    await fs.writeFile(`${snapshot}/manifest.json`, JSON.stringify({gameId, categoryName, installed}, null, 2) + '\n');
  }
  rounds[2].categories.push(category);
  await emit('command', {action: 'save', data: {rounds}});
  const after = await exportGame();
  assert.deepEqual(after.rounds, rounds);
  const unchanged = structuredClone(after);
  unchanged.rounds[2].categories.pop();
  assert.deepEqual(unchanged, before, 'Existing game content changed.');
  for (const asset of installed) {
    const response = await fetch(base + asset.mediaUrl);
    assert(response.ok && response.headers.get('content-type')?.startsWith('image/png'));
    assert.equal(sha256(Buffer.from(await response.arrayBuffer())), asset.sha256);
  }
  await fs.writeFile(`${snapshot}/game-after.json`, JSON.stringify(after, null, 2) + '\n');
  await fs.writeFile(`${directory}/installed.json`, JSON.stringify({gameId, round: 3, categoryId: category.id, categoryName, snapshot, installed}, null, 2) + '\n');
  console.log(JSON.stringify({game: after.name, gameId, round: 3, category: categoryName, questions: installed.map(({value, answer}) => ({value, answer})), otherContentPreserved: true, uploadedImagesVerified: true, snapshot}, null, 2));
} finally {
  socket.disconnect();
}
