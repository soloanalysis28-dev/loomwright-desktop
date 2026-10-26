export const BUNDLED_FONTS = Object.freeze([
  'Bitter',
  'Crimson Text',
  'EB Garamond',
  'Libre Baskerville',
  'Lora',
  'Merriweather',
  'PT Serif',
  'Playfair Display',
]);

export const WRITING_DEFAULTS = Object.freeze({
  pageStyle: 'paper', // 'paper' | 'flat'
  fontFamily: 'Lora', // Bundled font from fonts.css
  fontSize: 18, // 14 - 28
  lineHeight: 1.7, // 1.3 - 2.2
  columnWidth: 'medium', // 'narrow' | 'medium' | 'wide'
  firstLineIndent: false, // boolean
  toolbarMode: 'auto', // 'auto' | 'pinned'
  focusHides: Object.freeze({
    nav: true,
    toolbar: true,
    footer: false,
  }),
  typewriterScroll: false, // boolean
  spellcheck: true, // boolean
  smartQuotes: true, // boolean
  autosave: true, // boolean
  autosaveDelayMs: 1500, // 500 - 10000
  dailyGoal: 500, // 0 - 20000, 0 = off, step 50
  dashSeparatesWords: true, // boolean
  recogniserSensitivity: 'balanced', // 'strict' | 'balanced' | 'loose'
});

function clampNumber(value, min, max, fallback, step = null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  let clamped = Math.max(min, Math.min(max, num));
  if (step && step > 0) {
    clamped = Math.round((clamped - min) / step) * step + min;
  }
  return Number(clamped.toFixed(3)) % 1 === 0 ? Math.round(clamped) : Number(clamped.toFixed(2));
}

export function normalizeWritingSettings(input) {
  const source = input && typeof input === 'object' ? input : {};

  // Page style
  const pageStyle = source.pageStyle === 'flat' ? 'flat' : 'paper';

  // Font family
  const fontFamily = BUNDLED_FONTS.includes(source.fontFamily)
    ? source.fontFamily
    : WRITING_DEFAULTS.fontFamily;

  // Font size (14 - 28, step 1)
  const fontSize = clampNumber(source.fontSize, 14, 28, WRITING_DEFAULTS.fontSize, 1);

  // Line height (1.3 - 2.2, step 0.1)
  const rawLineHeight = Number(source.lineHeight);
  let lineHeight = WRITING_DEFAULTS.lineHeight;
  if (Number.isFinite(rawLineHeight)) {
    const clamped = Math.max(1.3, Math.min(2.2, rawLineHeight));
    lineHeight = Math.round(clamped * 10) / 10;
  }

  // Column width
  const columnWidth = ['narrow', 'medium', 'wide'].includes(source.columnWidth)
    ? source.columnWidth
    : WRITING_DEFAULTS.columnWidth;

  // First-line indent
  const firstLineIndent = typeof source.firstLineIndent === 'boolean'
    ? source.firstLineIndent
    : WRITING_DEFAULTS.firstLineIndent;

  // Toolbar mode
  const toolbarMode = source.toolbarMode === 'pinned' ? 'pinned' : 'auto';

  // Focus hides
  const rawFocusHides = source.focusHides && typeof source.focusHides === 'object' ? source.focusHides : {};
  const focusHides = Object.freeze({
    nav: typeof rawFocusHides.nav === 'boolean' ? rawFocusHides.nav : WRITING_DEFAULTS.focusHides.nav,
    toolbar: typeof rawFocusHides.toolbar === 'boolean' ? rawFocusHides.toolbar : WRITING_DEFAULTS.focusHides.toolbar,
    footer: typeof rawFocusHides.footer === 'boolean' ? rawFocusHides.footer : WRITING_DEFAULTS.focusHides.footer,
  });

  // Typewriter scroll
  const typewriterScroll = typeof source.typewriterScroll === 'boolean'
    ? source.typewriterScroll
    : WRITING_DEFAULTS.typewriterScroll;

  // Spellcheck
  const spellcheck = typeof source.spellcheck === 'boolean'
    ? source.spellcheck
    : WRITING_DEFAULTS.spellcheck;

  // Smart quotes
  const smartQuotes = typeof source.smartQuotes === 'boolean'
    ? source.smartQuotes
    : WRITING_DEFAULTS.smartQuotes;

  // Autosave
  const autosave = typeof source.autosave === 'boolean'
    ? source.autosave
    : WRITING_DEFAULTS.autosave;

  // Autosave delay (500 - 10000 ms, default 1500)
  const autosaveDelayMs = clampNumber(source.autosaveDelayMs, 500, 10000, WRITING_DEFAULTS.autosaveDelayMs, 100);

  // Daily goal (0 - 20000, step 50, default 500)
  const dailyGoal = clampNumber(source.dailyGoal, 0, 20000, WRITING_DEFAULTS.dailyGoal, 50);

  // Dash separates words
  const dashSeparatesWords = typeof source.dashSeparatesWords === 'boolean'
    ? source.dashSeparatesWords
    : WRITING_DEFAULTS.dashSeparatesWords;

  // Recogniser sensitivity ('strict' | 'balanced' | 'loose')
  const recogniserSensitivity = ['strict', 'balanced', 'loose'].includes(source.recogniserSensitivity)
    ? source.recogniserSensitivity
    : WRITING_DEFAULTS.recogniserSensitivity;

  return {
    pageStyle,
    fontFamily,
    fontSize,
    lineHeight,
    columnWidth,
    firstLineIndent,
    toolbarMode,
    focusHides,
    typewriterScroll,
    spellcheck,
    smartQuotes,
    autosave,
    autosaveDelayMs,
    dailyGoal,
    dashSeparatesWords,
    recogniserSensitivity,
  };
}
