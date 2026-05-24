'use client';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

/**
 * Inline audio player for an embedded audio file. Read-only chrome (the node is
 * an atom). `contentEditable={false}` + `stopPropagation` on pointer events so
 * the native controls (play / scrub) work instead of selecting the node; the
 * left-gutter drag handle still moves the block.
 */
export function AudioView({ node }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : undefined;
  const filename = typeof node.attrs.filename === 'string' ? node.attrs.filename : null;
  return (
    <NodeViewWrapper className="my-3">
      <audio
        controls
        src={src}
        contentEditable={false}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full"
      />
      {filename && (
        <span className="mt-1 block truncate text-xs text-muted-foreground">{filename}</span>
      )}
    </NodeViewWrapper>
  );
}
