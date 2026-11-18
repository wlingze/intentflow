// highlight.js 的类型入口只声明了主模块和语言模块，core 子路径需要补一份。
declare module 'highlight.js/lib/core' {
  import type { HLJSApi } from 'highlight.js';
  const hljs: HLJSApi;
  export default hljs;
}