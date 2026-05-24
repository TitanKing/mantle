import { describe, expect, it } from 'vitest';
import { renderPageDoc } from './render-page-doc';

const opts = { assetUrl: (id: string) => `/s/T/a/${id}` };
const doc = (content: unknown[]) => ({ type: 'doc', content });

describe('renderPageDoc', () => {
  it('escapes text and applies marks', () => {
    const html = renderPageDoc(
      doc([{ type: 'paragraph', content: [{ type: 'text', text: '<x> & y', marks: [{ type: 'bold' }] }] }]),
      opts,
    );
    expect(html).toBe('<p><strong>&lt;x&gt; &amp; y</strong></p>');
  });

  it('renders callouts, images (asset-rewritten), and task lists', () => {
    const html = renderPageDoc(
      doc([
        { type: 'callout', attrs: { variant: 'warning' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
        { type: 'image', attrs: { nodeId: 'f1', alt: 'pic' } },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] }] },
      ]),
      opts,
    );
    expect(html).toContain('data-callout data-variant="warning"');
    expect(html).toContain('src="/s/T/a/f1"');
    expect(html).toContain('data-checked="true"');
  });

  it('pre-renders math (KaTeX) and code (lowlight)', () => {
    const html = renderPageDoc(
      doc([
        { type: 'blockMath', attrs: { latex: 'x^2' } },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] },
      ]),
      opts,
    );
    expect(html).toContain('katex'); // KaTeX wraps output in .katex
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('const'); // code text survives highlighting
  });

  it('renders sub/superscript marks and paragraph alignment', () => {
    const html = renderPageDoc(
      doc([
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            { type: 'text', text: 'H' },
            { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
            { type: 'text', text: 'O' },
            { type: 'text', text: '2', marks: [{ type: 'superscript' }] },
          ],
        },
      ]),
      opts,
    );
    expect(html).toContain('<p style="text-align:center">');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
  });

  it('resolves emoji glyphs', () => {
    const html = renderPageDoc(
      doc([{ type: 'paragraph', content: [{ type: 'emoji', attrs: { name: 'tada' } }] }]),
      opts,
    );
    expect(html).toContain('🎉');
    expect(html).not.toContain(':tada:');
  });

  it('embeds audio (asset-rewritten) and renders details', () => {
    const html = renderPageDoc(
      doc([
        { type: 'audio', attrs: { nodeId: 'a1' } },
        {
          type: 'details',
          attrs: { open: true },
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: 'Notes' }] },
            { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] },
          ],
        },
      ]),
      opts,
    );
    expect(html).toContain('<audio controls src="/s/T/a/a1">');
    expect(html).toContain('<details open><summary>Notes</summary>');
  });

  it('builds a sanitized YouTube embed and ignores non-YouTube urls', () => {
    const ok = renderPageDoc(
      doc([{ type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }]),
      opts,
    );
    expect(ok).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(ok).toContain('allowfullscreen');

    const bad = renderPageDoc(doc([{ type: 'youtube', attrs: { src: 'https://evil.test/x' } }]), opts);
    expect(bad).not.toContain('<iframe');
  });

  it('renders merged + colour-tinted table cells', () => {
    const html = renderPageDoc(
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 2, backgroundColor: 'chart-2' },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'wide' }] }],
                },
              ],
            },
          ],
        },
      ]),
      opts,
    );
    expect(html).toContain('<td colspan="2"');
    expect(html).toContain('background-color:color-mix');
    // An unknown token is dropped (no arbitrary style injection).
    const bad = renderPageDoc(
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', attrs: { backgroundColor: 'red; x:1' }, content: [] }],
            },
          ],
        },
      ]),
      opts,
    );
    expect(bad).not.toContain('background-color');
  });

  it('neutralizes dangerous link protocols', () => {
    const html = renderPageDoc(
      doc([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }]),
      opts,
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });
});
