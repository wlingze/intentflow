import type { CodeFile } from '../types';

export interface TreeFile {
  type: 'file';
  name: string;
  path: string;
  file: CodeFile;
}

export interface TreeDir {
  type: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeDir | TreeFile;

export function buildTree(files: CodeFile[], onlyChanged: boolean): TreeNode[] {
  const root: TreeDir = { type: 'dir', name: '', path: '', children: [] };

  for (const file of files) {
    if (onlyChanged && file.status === 'unchanged') continue;
    const parts = file.path.split('/').filter(Boolean);
    let cursor = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const name = parts[index];
      const path = parts.slice(0, index + 1).join('/');
      let child = cursor.children.find(
        (node): node is TreeDir => node.type === 'dir' && node.name === name,
      );
      if (!child) {
        child = { type: 'dir', name, path, children: [] };
        cursor.children.push(child);
      }
      cursor = child;
    }
    cursor.children.push({
      type: 'file',
      name: parts[parts.length - 1] ?? file.path,
      path: file.path,
      file,
    });
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    for (const node of nodes) {
      if (node.type === 'dir') node.children = sortNodes(node.children);
    }
    return nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  };

  return sortNodes(root.children);
}

export function countChanged(node: TreeNode): number {
  if (node.type === 'file') return node.file.status === 'unchanged' ? 0 : 1;
  return node.children.reduce((total, child) => total + countChanged(child), 0);
}
