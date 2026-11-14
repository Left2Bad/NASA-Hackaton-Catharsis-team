import { marked } from 'marked';

/**
 * docs/methodology.md as HTML for the "Method" page. The file belongs to this repository,
 * so its HTML is trusted. The note for the team above the first section is left out,
 * headings go one level down (the page has its own title), wide tables get a wrapper that
 * scrolls, and outside links open in a new tab.
 */
export function methodologyHtml(markdown: string): string {
  const firstSection = markdown.indexOf('\n## ');
  const body = firstSection === -1 ? markdown : markdown.slice(firstSection);
  return marked
    .parse(body, { async: false })
    .replace(
      /<(\/?)h([2-5])>/g,
      (_, slash: string, level: string) => `<${slash}h${Number(level) + 1}>`,
    )
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/<a href="http/g, '<a target="_blank" rel="noreferrer" href="http');
}
