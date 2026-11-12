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

export function countFiles(node: TreeNode): number {
  if (node.type === 'file') return 1;
  return node.children.reduce((total, child) => total + countFiles(child), 0);
}

// countViewed reports how many files under the node are already reviewed.
export function countViewed(node: TreeNode, done: (path: string) => boolean): number {
  if (node.type === 'file') return done(node.path) ? 1 : 0;
  return node.children.reduce((total, child) => total + countViewed(child, done), 0);
}

export function countChanged(node: TreeNode): number {
  if (node.type === 'file') return node.file.status === 'unchanged' ? 0 : 1;
  return node.children.reduce((total, child) => total + countChanged(child), 0);
}

// flattenTree returns file paths in the exact order the sidebar renders them.
export function flattenTree(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type === 'dir') walk(node.children);
      else out.push(node.path);
    }
  };
  walk(nodes);
  return out;
}
