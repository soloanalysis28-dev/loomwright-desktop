import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachChapterMemories,
  attachVeritasReferenceSections,
  buildVeritasPrompt,
  getVeritasViewConversation,
  normalizeVeritasConversation,
  serializeLinkedChapterContext,
  serializeVeritasViewContext,
  VERITAS_CONTEXT_LIMIT,
  VERITAS_MAX_LINKED_CHAPTERS
} from './veritas-chat.mjs';

test('serializes the writing view and preserves the active chapter context', () => {
  const context = serializeVeritasViewContext('write', {
    projectName: 'The Glass Orchard',
    chapter: { title: 'The Conservatory' },
    editorText: 'Mara turns the brass key.'
  });

  assert.match(context, /Project: The Glass Orchard/);
  assert.match(context, /Chapter: The Conservatory/);
  assert.match(context, /Mara turns the brass key/);
});

test('serializes metrics for Veritas analysis', () => {
  const context = serializeVeritasViewContext('metrics', {
    projectName: 'The Glass Orchard',
    metrics: { totalWords: 1200, chapters: [{ title: 'The Conservatory', words: 1200 }] }
  });

  assert.match(context, /"totalWords": 1200/);
  assert.match(context, /"The Conservatory"/);
});

test('serializes character profiles and chapter mentions', () => {
  const context = serializeVeritasViewContext('characters', {
    projectName: 'The Glass Orchard',
    characters: [{ name: 'Mara', role: 'protagonist', chapters: [{ title: 'The Conservatory', mentions: 4 }] }]
  });

  assert.match(context, /"name": "Mara"/);
  assert.match(context, /"mentions": 4/);
});

test('serializes story web nodes, character appearances, and links', () => {
  const context = serializeVeritasViewContext('web', {
    projectName: 'The Glass Orchard',
    graph: {
      chapters: [{ title: 'The Conservatory' }],
      characters: [{ name: 'Mara' }],
      customNodes: [{ id: 'key', type: 'object', label: 'Brass key' }],
      links: [{ from: 'mara', to: 'key' }]
    }
  });

  assert.match(context, /"Brass key"/);
  assert.match(context, /"from": "mara"/);
  assert.match(context, /"name": "Mara"/);
});

test('keeps Veritas instructions while limiting long chat history', () => {
  const prompt = buildVeritasPrompt([{ role: 'user', text: 'x'.repeat(25_000) }]);

  assert.ok(prompt.length <= 18_000);
  assert.match(prompt, /^Continue this conversation with the writer\./);
  assert.match(prompt, /x{100,}$/);
});

test('keeps the combined context and saved chapter memory within the endpoint limit', () => {
  const context = attachChapterMemories('draft '.repeat(20_000), ['Mara has the brass key.']);

  assert.ok(context.length <= VERITAS_CONTEXT_LIMIT);
  assert.match(context, /Chapter-specific saved memory/);
  assert.match(context, /Mara has the brass key\./);
});

test('attaches story memory, chapter memory, and explicitly linked chapter text', () => {
  const linkedChapters = [
    { title: 'The Theft', text: 'Mara hides the brass key beneath the floor.' },
    ...Array.from({ length: VERITAS_MAX_LINKED_CHAPTERS }, (_, index) => ({
      title: `Chapter ${index + 2}`,
      text: `Continuity detail ${index + 2}.`
    }))
  ];
  const context = attachVeritasReferenceSections('Active chapter: The Return.', {
    centralMemories: ['The brass key opens the orchard gate.'],
    chapterMemories: ['Mara promised to return the key.'],
    linkedChapters
  });

  assert.ok(context.length <= VERITAS_CONTEXT_LIMIT);
  assert.match(context, /Active chapter: The Return/);
  assert.match(context, /Story-wide Veritas memory/);
  assert.match(context, /The brass key opens the orchard gate/);
  assert.match(context, /Chapter-specific saved memory/);
  assert.match(context, /Mara promised to return the key/);
  assert.match(context, /Linked chapter: The Theft/);
  assert.match(context, /Mara hides the brass key beneath the floor/);
  assert.doesNotMatch(context, /Chapter 6/);
});

test('limits each linked chapter excerpt and the total linked chapter count', () => {
  const chapters = Array.from({ length: VERITAS_MAX_LINKED_CHAPTERS + 2 }, (_, index) => ({
    title: `Chapter ${index + 1}`,
    text: 'x'.repeat(10_000)
  }));
  const context = serializeLinkedChapterContext(chapters);

  assert.equal((context.match(/Linked chapter:/g) || []).length, VERITAS_MAX_LINKED_CHAPTERS);
  assert.ok(context.length < VERITAS_MAX_LINKED_CHAPTERS * 6_200);
});

test('normalizes bounded view histories without accepting unknown roles', () => {
  const normalized = normalizeVeritasConversation([
    { role: 'system', text: 'not a chat turn' },
    { role: 'user', text: 'x'.repeat(5_000) },
    { role: 'assistant', text: 'answer' }
  ], 1, 4_000);

  assert.deepEqual(normalized, [{ role: 'assistant', text: 'answer' }]);
});

test('keeps Metrics, Characters, and Story Web chats isolated per project', () => {
  const project = {};
  const metrics = getVeritasViewConversation(project, 'metrics');
  metrics.push({ role: 'user', text: 'How is the pacing?' });

  assert.deepEqual(getVeritasViewConversation(project, 'metrics'), metrics);
  assert.deepEqual(getVeritasViewConversation(project, 'characters'), []);
  assert.deepEqual(getVeritasViewConversation(project, 'web'), []);
  assert.deepEqual(getVeritasViewConversation(project, 'write'), []);
});
