import fontUrl from '@fontsource-variable/geologica/files/geologica-latin-wght-normal.woff2?url';

// The typeface of the page, made available to exported images.
//
// The canvas can use the fonts of the page directly. An SVG painted as an image cannot:
// it is a separate document with no access to them. So the font file is put inside the
// SVG as a data URI. The Latin subset (25 KB) covers everything the exports print:
// digits, Latin letters, the degree sign, the superscript two and the typographic minus.

/** The family name the page uses for Geologica. */
export const PAGE_FONT = 'Geologica Variable';

/** Text of exported images: the page typeface, with system fonts as a fallback. */
export const EXPORT_FONT = `'${PAGE_FONT}', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;

let fontFace: Promise<string> | null = null;

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The font file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * The `@font-face` rule that carries the font inside an SVG. It is loaded once and kept.
 * If the font cannot be loaded, the rule is empty and the image falls back to the
 * system font: an export in another typeface is better than no export.
 */
export function embeddedFontFace(): Promise<string> {
  fontFace ??= fetch(fontUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Font request failed with status ${response.status}`);
      return response.blob();
    })
    .then(toDataUrl)
    .then(
      (dataUrl) =>
        `@font-face{font-family:'${PAGE_FONT}';font-weight:100 900;src:url(${dataUrl}) format('woff2');}`,
    )
    .catch(() => '');
  return fontFace;
}

/** Puts a stylesheet into an SVG drawing, right after its opening tag. */
export function withStyle(markup: string, css: string): string {
  if (css === '') return markup;
  return markup.replace(/<svg\b[^>]*>/, (open) => `${open}<style>${css}</style>`);
}

/** Waits until the page font is ready for the canvas; never fails the export. */
export async function pageFontReady(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`400 12px '${PAGE_FONT}'`),
      document.fonts.load(`600 16px '${PAGE_FONT}'`),
    ]);
  } catch {
    // Without the font the canvas uses the fallback of EXPORT_FONT.
  }
}
