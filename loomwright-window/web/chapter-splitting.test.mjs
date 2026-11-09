import assert from 'node:assert/strict';
import test from 'node:test';
import { splitDocumentHtml } from './chapter-splitting.mjs';

class FixtureElement {
  constructor(tagName, attributes, innerHTML) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.innerHTML = innerHTML;
    this.outerHTML = `<${tagName}${attributes}>${innerHTML}</${tagName}>`;
  }

  get className() {
    return this.attributes.match(/\bclass=["']([^"']*)["']/i)?.[1] || '';
  }

  get textContent() {
    return this.innerHTML.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
  }

  getAttribute(name) {
    return this.attributes.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] || null;
  }

  querySelector(selector) {
    return selector === 'a' && /<a(?:\s|>)/i.test(this.innerHTML) ? {} : null;
  }
}

globalThis.document = {
  createElement() {
    return {
      children: [],
      set innerHTML(html) {
        this.children = [...html.matchAll(/<(h[1-6]|p)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi)]
          .map(([, tag, attributes = '', content]) => new FixtureElement(tag, attributes, content));
      }
    };
  }
};

test('skips linked contents entries and front matter before real chapters', () => {
  const chapters = splitDocumentHtml([
    '<p>Title page and copyright</p>',
    '<h1>Contents</h1>',
    '<p><a href="#chapter-one">Chapter One: The Beginning ........ 3</a></p>',
    '<p><a href="#chapter-two">Chapter Two: The Journey ........ 9</a></p>',
    '<h1>Chapter One: The Beginning</h1>',
    '<p>The actual first chapter.</p>',
    '<h1>Chapter Two: The Journey</h1>',
    '<p>The actual second chapter.</p>'
  ].join(''), 'Imported book');

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map(chapter => chapter.title), [
    'Chapter One: The Beginning',
    'Chapter Two: The Journey'
  ]);
  assert.match(chapters[0].html, /The actual first chapter/);
  assert.doesNotMatch(chapters[0].html, /Contents|Title page|href="#chapter-one"/);
  assert.match(chapters[1].html, /The actual second chapter/);
});

test('keeps an actual single chapter while removing a table of contents', () => {
  const chapters = splitDocumentHtml([
    '<p>Title page</p>',
    '<h1>Contents</h1>',
    '<p>Chapter One: The Beginning .... 3</p>',
    '<h1>Chapter One: The Beginning</h1>',
    '<p>The only chapter.</p>'
  ].join(''), 'Imported book');

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, 'Chapter One: The Beginning');
  assert.match(chapters[0].html, /The only chapter/);
  assert.doesNotMatch(chapters[0].html, /Contents|Title page/);
});

test('prefers semantic chapter headings after an unformatted contents list', () => {
  const chapters = splitDocumentHtml([
    '<h1>Contents</h1>',
    '<p>Chapter One: Listed title</p>',
    '<p>Chapter Two: Another listed title</p>',
    '<h1>Chapter One: Actual heading</h1>',
    '<p>The first chapter.</p>',
    '<h1>Chapter Two: Actual heading</h1>',
    '<p>The second chapter.</p>'
  ].join(''), 'Imported book');

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map(chapter => chapter.title), [
    'Chapter One: Actual heading',
    'Chapter Two: Actual heading'
  ]);
  assert.doesNotMatch(chapters[0].html, /Listed title|Contents/);
});

test('skips Word TOC-styled headings before the actual chapter headings', () => {
  const chapters = splitDocumentHtml([
    '<h1>Contents</h1>',
    '<h1 class="MsoToc1">Chapter One: Listed title</h1>',
    '<h1 class="MsoToc1">Chapter Two: Listed title</h1>',
    '<h1>Chapter One: Actual heading</h1>',
    '<p>The first chapter.</p>',
    '<h1>Chapter Two: Actual heading</h1>',
    '<p>The second chapter.</p>'
  ].join(''), 'Imported book');

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map(chapter => chapter.title), [
    'Chapter One: Actual heading',
    'Chapter Two: Actual heading'
  ]);
  assert.doesNotMatch(chapters[0].html, /Listed title|Contents/);
});

test('skips duplicate semantic chapter headings in an unformatted contents page', () => {
  const chapters = splitDocumentHtml([
    '<h1>Contents</h1>',
    '<h1>Chapter One: Listed title</h1>',
    '<h1>Chapter Two: Listed title</h1>',
    '<h1>Chapter One: Actual chapter</h1>',
    '<p>The first chapter.</p>',
    '<h1>Chapter Two: Actual chapter</h1>',
    '<p>The second chapter.</p>'
  ].join(''), 'Imported book');

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map(chapter => chapter.title), [
    'Chapter One: Actual chapter',
    'Chapter Two: Actual chapter'
  ]);
  assert.doesNotMatch(chapters[0].html, /Listed title|Contents/);
});

test('preserves actual numeric chapter headings while skipping dotted contents entries', () => {
  const chapters = splitDocumentHtml([
    '<h1>Contents</h1>',
    '<p>Chapter 1: Opening ........ 1</p>',
    '<p>Chapter 2: Journey ........ 8</p>',
    '<p>Chapter 1</p>',
    '<p>The first chapter.</p>',
    '<p>Chapter 2</p>',
    '<p>The second chapter.</p>'
  ].join(''), 'Imported book');

  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map(chapter => chapter.title), ['Chapter 1', 'Chapter 2']);
  assert.doesNotMatch(chapters[0].html, /Contents|Opening|Journey|The second chapter/);
  assert.match(chapters[0].html, /The first chapter/);
});

test('does not turn a single chapter-looking title into a split', () => {
  const chapters = splitDocumentHtml(
    '<p>A preface</p><h1>Chapter One: The Beginning</h1><p>Book text.</p>',
    'Imported book'
  );

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, 'Imported book');
  assert.match(chapters[0].html, /A preface/);
});

test('does not split at preliminary section headings', () => {
  const chapters = splitDocumentHtml([
    '<h1>Chapter One: The Beginning</h1>',
    '<p>Chapter text.</p>',
    '<h1>Acknowledgments</h1>',
    '<p>Thanks to everyone.</p>',
    '<h1>Chapter Two: The Journey</h1>',
    '<p>More chapter text.</p>'
  ].join(''), 'Imported book');

  assert.equal(chapters.length, 2);
  assert.match(chapters[0].html, /Chapter text/);
  assert.doesNotMatch(chapters[0].html, /Acknowledgments|Thanks to everyone/);
  assert.equal(chapters[1].title, 'Chapter Two: The Journey');
});
