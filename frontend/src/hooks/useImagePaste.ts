import { useState, type ClipboardEvent } from 'react';
import { reviewAssetUrl, uploadReviewAsset } from '../lib/api';

const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// Images are pasted directly into the comment body as markdown, so the review
// JSON stays one text field and the right panel needs no attachment UI.
export function useImagePaste(value: string, onChange: (next: string) => void) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const onPaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && TYPES.has(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    setUploading(true);
    setError('');
    try {
      let token = '';
      for (const file of files) {
        if (file.size > 6 * 1024 * 1024) throw new Error('单张图片不能超过 6MB');
        token += `![图片](${reviewAssetUrl(await uploadReviewAsset(file))})`;
      }
      onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
      requestAnimationFrame(() => {
        element.focus();
        const caret = start + token.length;
        element.setSelectionRange(caret, caret);
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  };

  return { onPaste, uploading, error };
}
