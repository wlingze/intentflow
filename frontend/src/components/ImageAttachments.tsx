import { reviewAssetUrl } from '../lib/api';
import styles from './ImageAttachments.module.css';

// Legacy: older reviews stored attachment names in Comment.images. New
// comments paste Markdown images directly into the body.
export function CommentImages({ images }: { images: string[] }) {
  if (!images?.length) return null;
  return <div className={styles.gallery}>
    {images.map((name) => <a key={name} href={reviewAssetUrl(name)} target="_blank" rel="noreferrer" title="打开原图"><img src={reviewAssetUrl(name)} alt="" /></a>)}
  </div>;
}
