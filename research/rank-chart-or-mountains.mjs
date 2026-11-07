import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';

const base = 'http://localhost:43187', gameId = '95AF7D';
const directory = 'research/candles-or-mountains';
const manifest = JSON.parse(await fs.readFile(`${directory}/installed.json`, 'utf8'));
// Subjective visual ranking: obvious silhouettes first, misleading shapes last.
const ranking = [
  {sampleId: 6, reason: 'Самый узнаваемый силуэт вулкана; простой вход в категорию.'},
  {sampleId: 2, reason: 'Отчётливая вершина и плавные склоны подсказывают гору.'},
  {sampleId: 3, reason: 'Частые резкие колебания помогают узнать ценовой график.'},
  {sampleId: 5, reason: 'Один большой пик похож на гору, но мелкие колебания дают подсказку.'},
  {sampleId: 4, reason: 'Чередование вершин и плато можно принять за движение цены.'},
  {sampleId: 1, reason: 'Ценовой график с выраженной вершиной и нисходящим хребтом напоминает горы.'},
];
const socket = io(base, {transports: ['websocket'], reconnection: false, timeout: 10000});
let state;
socket.on('state', value => { state = value; });
const emit = (event, input) => new Promise((resolve, reject) => socket.timeout(10000).emit(event, input, (error, result) => {
  if (error) reject(error);
  else if (!result?.ok) reject(new Error(result?.error || 'Command failed'));
  else resolve(result);
}));
async function exported() {
  const response = await fetch(`${base}/api/games/${gameId}/export`);
  assert(response.ok);
  return response.json();
}
try {
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  await emit('subscribe', {gameId, role: 'host', editing: true});
  assert.equal(state?.editLock, 'mine', 'Another editor holds the editing lock.');
  assert.equal(state?.status, 'lobby', 'Game must still be in preparation.');
  const before = await exported(), rounds = structuredClone(before.rounds);
  const category = rounds[2].categories.find(c => c.id === manifest.categoryId);
  assert.equal(category?.name, 'График или горы');
  assert.equal(category.questions.length, 6);
  const oldQuestions = structuredClone(category.questions);
  category.questions = ranking.map((entry, index) => {
    const installed = manifest.installed.find(a => a.sampleId === entry.sampleId);
    assert(installed);
    const question = oldQuestions.find(q => q.id === installed.questionId);
    assert(question);
    return {...question, value: (index + 1) * 300};
  });
  for (const question of category.questions) {
    const old = oldQuestions.find(q => q.id === question.id);
    assert.deepEqual({...question, value: old.value}, old, 'Only order and values may change.');
  }
  const pattern = category.questions.map(q => q.answer.startsWith('График') ? 'graph' : 'mountain');
  assert(pattern.some((kind, i) => i > 0 && kind === pattern[i - 1]), 'Answers must not alternate regularly.');
  const restored = structuredClone(rounds);
  restored[2].categories.find(c => c.id === category.id).questions = oldQuestions;
  assert.deepEqual(restored, before.rounds);
  const snapshot = `${directory}/ranking-${new Date().toISOString().replaceAll(':', '-')}`;
  await fs.mkdir(snapshot, {recursive: true});
  await fs.writeFile(`${snapshot}/game-before.json`, JSON.stringify(before, null, 2) + '\n');
  assert.deepEqual(await exported(), before, 'Game changed before save.');
  await emit('command', {action: 'save', data: {rounds}});
  const after = await exported();
  assert.deepEqual(after, {...before, rounds});
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(JSON.parse(await fs.readFile(`data/games/${gameId}.json`, 'utf8')).rounds, rounds);
  await fs.writeFile(`${snapshot}/game-after.json`, JSON.stringify(after, null, 2) + '\n');
  manifest.rankingSnapshot = snapshot;
  manifest.difficulty = 'Subjective visual ranking, easiest to hardest';
  manifest.installed = ranking.map((entry, index) => ({...manifest.installed.find(a => a.sampleId === entry.sampleId), value: (index + 1) * 300, difficultyReason: entry.reason}));
  await fs.writeFile(`${directory}/installed.json`, JSON.stringify(manifest, null, 2) + '\n');
  const summary = ranking.map((entry, index) => ({value: category.questions[index].value, answer: category.questions[index].answer, reason: entry.reason}));
  await fs.writeFile(`${snapshot}/ranking.json`, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({round: 3, category: category.name, ranking: summary, preservedImagesAnswersAndSources: true, savedToDisk: true}, null, 2));
} finally { socket.disconnect(); }
