import styles from './CommentBody.module.css';

const IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

export function CommentBody({ text }: { text: string }) {
  const nodes: Array<string | { src: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(IMAGE)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const src = match[1];
    nodes.push({ src });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <div className={styles.body}>
    {nodes.map((node, index) => typeof node === 'string'
      ? <span key={index} className={styles.text}>{node}</span>
      : <a key={index} href={node.src} target="_blank" rel="noreferrer" className={styles.image}><img src={node.src} alt="" /></a>)}
  </div>;
}
