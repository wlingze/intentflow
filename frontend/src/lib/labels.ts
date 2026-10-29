export function sourceLabel(source: string): string {
  switch (source) {
    case 'http_input': return 'HTTP 输入';
    case 'env': return '环境变量';
    case 'literal': return '字面量';
    case 'file': return '文件';
    case 'db': return '数据库';
    default: return source || '未知来源';
  }
}

export function categoryLabel(category: string): string {
  switch (category) {
    case 'sql': return 'SQL 执行';
    case 'file': return '文件读写';
    case 'exec': return '命令执行';
    case 'net': return '网络请求';
    case 'template': return '模板渲染';
    default: return category || '副作用';
  }
}

export function shapeLabel(shape: string): string {
  switch (shape) {
    case 'direct': return '参数化直传';
    case 'format': return '格式化拼接';
    case 'concat': return '字符串拼接';
    case 'member': return '成员访问';
    case 'call': return '函数调用';
    default: return shape || '未知形态';
  }
}

export function severityLabel(severity: string): string {
  switch (severity) {
    case 'high': return '高';
    case 'warn': return '警告';
    case 'info': return '提示';
    default: return severity;
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'added': return '新增';
    case 'removed': return '删除';
    case 'modified': return '修改';
    default: return '未变';
  }
}
