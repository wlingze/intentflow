export type DiffRow =
  | { type: 'equal'; a: { n: number; text: string }; b: { n: number; text: string } }
  | { type: 'del'; a: { n: number; text: string } }
  | { type: 'add'; b: { n: number; text: string } };

export interface DiffStats {
  adds: number;
  dels: number;
}

// 大文件不跑 O(n*m) 矩阵，避免打开 review 时卡死。
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffRow[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');

  if (a.length * b.length > MAX_CELLS) {
    return fallbackDiff(a, b);
  }

  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'equal', a: { n: i + 1, text: a[i] }, b: { n: j + 1, text: b[j] } });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', a: { n: i + 1, text: a[i] } });
      i++;
    } else {
      rows.push({ type: 'add', b: { n: j + 1, text: b[j] } });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', a: { n: i + 1, text: a[i] } });
    i++;
  }
  while (j < m) {
    rows.push({ type: 'add', b: { n: j + 1, text: b[j] } });
    j++;
  }
  return rows;
}

function fallbackDiff(a: string[], b: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left !== undefined && right !== undefined && left === right) {
      rows.push({ type: 'equal', a: { n: i + 1, text: left }, b: { n: i + 1, text: right } });
    } else {
      if (left !== undefined) rows.push({ type: 'del', a: { n: i + 1, text: left } });
      if (right !== undefined) rows.push({ type: 'add', b: { n: i + 1, text: right } });
    }
  }
  return rows;
}

export function diffStats(rows: DiffRow[]): DiffStats {
  let adds = 0;
  let dels = 0;
  for (const row of rows) {
    if (row.type === 'add') adds++;
    else if (row.type === 'del') dels++;
  }
  return { adds, dels };
}
