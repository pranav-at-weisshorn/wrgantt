// Minimal Node.js typings for the comparison scripts (the app itself has no Node types).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: Uint8Array): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function statSync(path: string): { mtimeMs: number };
}
declare module 'node:path' {
  const path: {
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
    basename(p: string): string;
    dirname(p: string): string;
  };
  export default path;
}
declare namespace NodeJS {
  interface ErrnoException extends Error {
    code?: string;
  }
}
declare const process: { cwd(): string; argv: string[] };
