const NUMBER_WORDS = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)';
const CHAPTER_MARKER = new RegExp(`^(?:chapter|chap\\.?)\\s+(?:\\d{1,3}|[ivxlcdm]{1,12}|${NUMBER_WORDS})(?:\\s*(?:[:.\\-–—])\\s*|\\s+|$)(.*)$`, 'i');
const CHAPTER_ID = new RegExp(`^(?:chapter|chap\\.?)\\s+(\\d{1,3}|[ivxlcdm]{1,12}|${NUMBER_WORDS})\\b`, 'i');
const SPECIAL_SECTION = /^(?:prologue|epilogue|preface|foreword|afterword|introduction|acknowledg(?:e?ments?|ements?))(?:(?:\s*[:.\-–—]\s*|\s+)(.*))?$/i;
const PRELIMINARY_SECTION = /^(?:preface|foreword|afterword|introduction|acknowledg(?:e?ments?|ements?))\b/i;
const CONTENTS_HEADING = /^(?:(?:table\s+of\s+)?contents|contents\s+page)(?:\s*[:\-–—].*)?$/i;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isContentsHeading(node) {
  return CONTENTS_HEADING.test(cleanText(node.textContent));
}

function isSemanticHeading(node) {
  return /^H[1-6]$/i.test(String(node.tagName || ''));
}

function isContentsEntry(node) {
  const text = String(node.textContent || '');
  const style = `${node.className || ''} ${node.getAttribute?.('style') || ''}`;
  if (/(?:^|[\s_-])(?:mso)?(?:toc|tableofcontents)\s*\d*\b/i.test(style)) return true;
  return /(?:\.{2,}|…{1,}|·{2,}|_{3,}|\t)\s*(?:\d{1,4}|[ivxlcdm]{1,8})?\s*$/i.test(text);
}

function isLinked(node) {
  return Boolean(node.querySelector?.('a'));
}

function chapterHeadingKey(title) {
  const text = cleanText(title);
  const chapter = text.match(CHAPTER_MARKER);
  const hasChapterTitle = chapter && cleanText(chapter[1]);
  const withoutLeader = text.replace(/(?:\.{2,}|…+|·{2,}|_{3,}).*$/, '');
  return (hasChapterTitle ? withoutLeader.replace(/\s+\d{1,4}$/, '') : withoutLeader).toLocaleLowerCase();
}

function sameChapterHeading(first, second) {
  const firstId = first.match(CHAPTER_ID)?.[1]?.toLocaleLowerCase();
  const secondId = second.match(CHAPTER_ID)?.[1]?.toLocaleLowerCase();
  return (firstId && firstId === secondId) || chapterHeadingKey(first) === chapterHeadingKey(second);
}

export function chapterHeadingTitle(value) {
  const text = cleanText(value);
  if (!text) return '';
  const chapter = text.match(CHAPTER_MARKER);
  if (chapter) return cleanText(text);
  const special = text.match(SPECIAL_SECTION);
  return special ? cleanText(text) : '';
}

function htmlForNodes(nodes) {
  return nodes.map(node => node.outerHTML || '').join('').trim();
}

export function splitDocumentHtml(html, fallbackTitle = 'Untitled') {
  const source = String(html || '').trim();
  if (!source || typeof document === 'undefined') {
    return [{ title: cleanText(fallbackTitle) || 'Untitled', html: source || '<p></p>' }];
  }

  const container = document.createElement('div');
  container.innerHTML = source;
  const blocks = [...container.children];
  const contentsHeadings = blocks.filter(isContentsHeading);
  const headings = blocks
    .map((node, index) => ({ index, title: chapterHeadingTitle(node.textContent), node }))
    .filter(item => item.title && !PRELIMINARY_SECTION.test(item.title));
  const preliminaryIndexes = new Set(
    blocks
      .map((node, index) => ({ index, title: chapterHeadingTitle(node.textContent) }))
      .filter(item => item.title && PRELIMINARY_SECTION.test(item.title))
      .map(item => item.index)
  );

  const contentsEntries = new Set();
  for (const contentsHeading of contentsHeadings) {
    const contentsIndex = blocks.indexOf(contentsHeading);
    const candidates = headings.filter(item => item.index > contentsIndex);
    const firstSemanticChapter = candidates.findIndex((item, index) =>
      isSemanticHeading(item.node)
      && !isContentsEntry(item.node)
      && !isLinked(item.node)
      && !candidates.slice(index + 1).some(later => sameChapterHeading(item.title, later.title)));
    const firstChapter = firstSemanticChapter >= 0 ? firstSemanticChapter : candidates.findIndex((item, index) => {
      if (isContentsEntry(item.node) || isLinked(item.node)) return false;
      const key = chapterHeadingKey(item.title);
      return !candidates.slice(index + 1).some(later => chapterHeadingKey(later.title) === key);
    });

    if (firstChapter >= 0) {
      for (const item of candidates.slice(0, firstChapter)) contentsEntries.add(item.index);
    } else {
      for (const item of candidates) contentsEntries.add(item.index);
    }
  }

  const boundaries = headings.filter(item => !contentsEntries.has(item.index) && !isContentsEntry(item.node));

  // A single heading is usually a document title, not evidence of multiple chapters.
  const hasContentsAndOneChapter = contentsHeadings.length > 0 && boundaries.length === 1;
  if (boundaries.length < 2 && !hasContentsAndOneChapter) {
    return [{ title: cleanText(fallbackTitle) || 'Untitled', html: source }];
  }

  return boundaries.map((boundary, boundaryIndex) => {
    const next = boundaries[boundaryIndex + 1];
    const start = boundary.index;
    const end = next ? next.index : blocks.length;
    const chapterNodes = [];
    for (let index = start; index < end && !preliminaryIndexes.has(index); index += 1) {
      chapterNodes.push(blocks[index]);
    }
    const chapterHtml = htmlForNodes(chapterNodes);
    return {
      title: boundary.title.slice(0, 120) || `Chapter ${boundaryIndex + 1}`,
      html: chapterHtml || '<p></p>'
    };
  });
}
