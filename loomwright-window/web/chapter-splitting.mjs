const NUMBER_WORDS = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)';
const CHAPTER_MARKER = new RegExp(`^(?:chapter|chap\\.?)\\s+(?:\\d{1,3}|[ivxlcdm]{1,12}|${NUMBER_WORDS})(?:\\s*(?:[:.\\-–—])\\s*|\\s+|$)(.*)$`, 'i');
const SPECIAL_SECTION = /^(?:prologue|epilogue|preface|foreword|afterword|introduction|acknowledg(?:e?ments?|ements?))(?:(?:\s*[:.\-–—]\s*|\s+)(.*))?$/i;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
  const boundaries = blocks
    .map((node, index) => ({ index, title: chapterHeadingTitle(node.textContent), node }))
    .filter(item => item.title);

  // A single heading is usually a document title, not evidence of multiple chapters.
  if (boundaries.length < 2) {
    return [{ title: cleanText(fallbackTitle) || 'Untitled', html: source }];
  }

  return boundaries.map((boundary, boundaryIndex) => {
    const next = boundaries[boundaryIndex + 1];
    const start = boundary.index;
    const end = next ? next.index : blocks.length;
    const beforeFirstHeading = boundaryIndex === 0 ? htmlForNodes(blocks.slice(0, start)) : '';
    const chapterHtml = htmlForNodes(blocks.slice(start, end));
    return {
      title: boundary.title.slice(0, 120) || `Chapter ${boundaryIndex + 1}`,
      html: `${beforeFirstHeading}${chapterHtml}` || '<p></p>'
    };
  });
}
