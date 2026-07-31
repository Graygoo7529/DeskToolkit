/// <reference types="vite/client" />

// vite.config.ts 使用了 node:path 与 __dirname，但项目未安装 @types/node（且约定不新增依赖）。
// 这里提供最小环境声明，让 tsc --noEmit 通过；运行时由 Vite 自身（esbuild）加载配置，无实际影响。
declare module 'node:path' {
  export function resolve(...paths: string[]): string
}

declare const __dirname: string
