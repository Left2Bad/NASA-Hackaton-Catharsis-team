import { EXPORT_FONT, INK, MUTED, type SvgFigure } from './calendarSvg';

// Composes an exported image (requirement F24): a title, a legend, the drawing and the
// caption with the area, the period and the data source, on a white background.

/** One entry of the legend printed above a chart. */
export interface LegendItem {
  /** How the series is drawn: a line, a dashed line, a filled box or a hatched box. */
  kind: 'line' | 'dash' | 'box' | 'hatch';
  color: string;
  label: string;
}

export interface PngSpec {
  title: string;
  legend?: readonly LegendItem[];
  figure: SvgFigure;
  /** Lines under the drawing: the area, the period, the data source. */
  caption: readonly string[];
}

const PADDING = 24;
const TITLE_SIZE = 16;
const TEXT_SIZE = 12;
const CAPTION_SIZE = 11;
const KEY_WIDTH = 18;
const LEGEND_GAP = 18;

const font = (size: number, weight = 400) => `${weight} ${size}px ${EXPORT_FONT}`;

/** Where everything goes, in logical pixels. Pure, so it can be checked without a canvas. */
export interface PngLayout {
  width: number;
  height: number;
  titleY: number;
  /** Left edge of each legend entry, and the baseline they share. */
  legendX: number[];
  legendY: number;
  figureY: number;
  captionY: number[];
}

/** Lays the parts out one under another; the image is as wide as its widest part. */
export function layoutPng(
  spec: PngSpec,
  measure: (text: string, font: string) => number,
): PngLayout {
  const legend = spec.legend ?? [];
  let x = PADDING;
  const legendX = legend.map((item) => {
    const left = x;
    x += KEY_WIDTH + 6 + measure(item.label, font(TEXT_SIZE)) + LEGEND_GAP;
    return left;
  });
  const legendWidth = legend.length > 0 ? x - LEGEND_GAP - PADDING : 0;

  const contentWidth = Math.max(
    spec.figure.width,
    legendWidth,
    measure(spec.title, font(TITLE_SIZE, 600)),
    ...spec.caption.map((line) => measure(line, font(CAPTION_SIZE))),
  );

  const titleY = PADDING + TITLE_SIZE;
  const legendY = titleY + (legend.length > 0 ? 26 : 0);
  const figureY = legendY + 16;
  const firstCaption = figureY + spec.figure.height + 22;
  const captionY = spec.caption.map((_, index) => firstCaption + index * 16);
  return {
    width: Math.ceil(contentWidth) + PADDING * 2,
    height: firstCaption + (spec.caption.length - 1) * 16 + PADDING,
    titleY,
    legendX,
    legendY,
    figureY,
    captionY,
  };
}

/** Loads an SVG drawing as an image the canvas can paint. */
async function loadSvg(figure: SvgFigure): Promise<HTMLImageElement> {
  const image = new Image(figure.width, figure.height);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(figure.markup)}`;
  await image.decode();
  return image;
}

function drawKey(context: CanvasRenderingContext2D, item: LegendItem, x: number, baseline: number) {
  const middle = baseline - 4;
  if (item.kind === 'line' || item.kind === 'dash') {
    context.strokeStyle = item.color;
    context.lineWidth = 2;
    context.setLineDash(item.kind === 'dash' ? [5, 4] : []);
    context.beginPath();
    context.moveTo(x, middle);
    context.lineTo(x + KEY_WIDTH, middle);
    context.stroke();
    context.setLineDash([]);
    return;
  }
  context.fillStyle = item.color;
  context.globalAlpha = item.kind === 'hatch' ? 0.35 : 1;
  context.fillRect(x + 3, middle - 6, 12, 12);
  context.globalAlpha = 1;
  if (item.kind === 'hatch') {
    context.save();
    context.beginPath();
    context.rect(x + 3, middle - 6, 12, 12);
    context.clip();
    context.strokeStyle = item.color;
    context.lineWidth = 1.5;
    for (let offset = -12; offset < 14; offset += 4) {
      context.beginPath();
      context.moveTo(x + 3 + offset, middle + 6);
      context.lineTo(x + 15 + offset, middle - 6);
      context.stroke();
    }
    context.restore();
  }
}

/**
 * Renders the image as a PNG. `scale` 2 makes it sharp on slides and high-density screens.
 * Runs in the browser only: it needs a canvas.
 */
export async function renderPng(spec: PngSpec, scale = 2): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the image.');

  const layout = layoutPng(spec, (text, textFont) => {
    context.font = textFont;
    return context.measureText(text).width;
  });
  canvas.width = Math.round(layout.width * scale);
  canvas.height = Math.round(layout.height * scale);
  // Resizing a canvas resets its state, so the scale is set after it.
  context.scale(scale, scale);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, layout.width, layout.height);

  context.fillStyle = INK;
  context.font = font(TITLE_SIZE, 600);
  context.fillText(spec.title, PADDING, layout.titleY);

  (spec.legend ?? []).forEach((item, index) => {
    const x = layout.legendX[index];
    drawKey(context, item, x, layout.legendY);
    context.fillStyle = INK;
    context.font = font(TEXT_SIZE);
    context.fillText(item.label, x + KEY_WIDTH + 6, layout.legendY);
  });

  const image = await loadSvg(spec.figure);
  context.drawImage(image, PADDING, layout.figureY, spec.figure.width, spec.figure.height);

  context.fillStyle = MUTED;
  context.font = font(CAPTION_SIZE);
  spec.caption.forEach((line, index) => {
    context.fillText(line, PADDING, layout.captionY[index]);
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be saved.'))),
      'image/png',
    );
  });
}
