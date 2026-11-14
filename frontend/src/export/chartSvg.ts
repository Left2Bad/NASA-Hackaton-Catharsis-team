import type { SvgFigure } from './calendarSvg';
import { EXPORT_FONT } from './font';

// Turns a chart that is on the page into a standalone SVG for the PNG export (F24).
// On the page the chart is styled by the stylesheet; a standalone image has no stylesheet,
// so the look of every element is written into the copy itself.

/** The style properties that decide how a chart mark or label looks. */
const STYLE_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'font-size',
  'font-weight',
  'text-anchor',
  'paint-order',
];

/**
 * A copy of the chart with its styles written inline. Elements marked `data-export-skip`
 * are left out: the crosshair, the dots of the picked position and the pointer catcher
 * belong to the interaction, not to the picture.
 */
export function chartSvg(svg: SVGSVGElement): SvgFigure {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const originals = Array.from(svg.querySelectorAll('*'));
  const copies = Array.from(copy.querySelectorAll('*'));

  originals.forEach((original, index) => {
    const target = copies[index];
    if (original.hasAttribute('data-export-skip')) return;
    const computed = window.getComputedStyle(original);
    const inline = STYLE_PROPERTIES.map((property) => [
      property,
      computed.getPropertyValue(property),
    ])
      .filter(([, value]) => value !== '')
      .map(([property, value]) => `${property}:${value}`)
      .join(';');
    // An inline style the element already had (the hatch fill of a bar) stays last and wins.
    const own = target.getAttribute('style');
    target.setAttribute('style', own ? `${inline};${own}` : inline);
    target.removeAttribute('class');
  });
  copy.querySelectorAll('[data-export-skip]').forEach((element) => element.remove());

  // The serializer writes the SVG namespace itself; adding it by hand would declare it twice.
  copy.setAttribute('font-family', EXPORT_FONT);
  copy.removeAttribute('class');
  copy.removeAttribute('aria-hidden');

  return {
    markup: new XMLSerializer().serializeToString(copy),
    width: Number(svg.getAttribute('width')),
    height: Number(svg.getAttribute('height')),
  };
}
