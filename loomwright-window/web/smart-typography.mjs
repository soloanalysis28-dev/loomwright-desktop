/**
 * Pure module for smart typography conversions.
 * Transforms straight quotes to curly quotes by context, apostrophes inside words,
 * "--" to em dash ("—"), and "..." to ellipsis ("…").
 */

const OPENING_CONTEXT_PUNCTUATION = new Set(['(', '[', '{', '<', '«', '„', '‹', '—', '–', '~']);

export function smartenInput(prevChar, typedChar) {
  const prevStr = String(prevChar ?? '');
  const lastChar = prevStr.length > 0 ? prevStr[prevStr.length - 1] : '';

  // Double quotes
  if (typedChar === '"') {
    if (
      !lastChar ||
      /\s/u.test(lastChar) ||
      OPENING_CONTEXT_PUNCTUATION.has(lastChar) ||
      lastChar === '‘' ||
      lastChar === "'"
    ) {
      return '“';
    }
    return '”';
  }

  // Single quotes / apostrophes
  if (typedChar === "'") {
    // Apostrophe inside words (e.g. don't, cat's, 'em)
    if (/[\p{L}\p{N}]/u.test(lastChar)) {
      return '’';
    }
    // Opening single quote after whitespace, line start, opening brackets, em dash, or nested opening double quote
    if (
      !lastChar ||
      /\s/u.test(lastChar) ||
      OPENING_CONTEXT_PUNCTUATION.has(lastChar) ||
      lastChar === '“' ||
      lastChar === '"'
    ) {
      return '‘';
    }
    // Closing quote after punctuation (e.g. ?', !', .')
    return '’';
  }

  // Em dash ("--" -> "—")
  if (typedChar === '-') {
    if (lastChar === '-') {
      return '—';
    }
    return '-';
  }

  // Ellipsis ("..." -> "…")
  if (typedChar === '.') {
    if (prevStr === '..' || prevStr.endsWith('..')) {
      return '…';
    }
    return '.';
  }

  return typedChar;
}

/**
 * Smarten an entire string of text with typographic quotes, em dashes, and ellipses.
 */
export function smartenText(text) {
  if (!text) return '';
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") {
      const prev = result.slice(-2);
      result += smartenInput(prev, char);
    } else if (char === '-' && text[i + 1] === '-') {
      result += '—';
      i++; // skip next dash
    } else if (char === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
      result += '…';
      i += 2; // skip next two dots
    } else {
      result += char;
    }
  }
  return result;
}
