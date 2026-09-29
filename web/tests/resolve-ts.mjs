import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(specifier, context.parentURL)
    for (const suffix of ['.ts', '/index.ts']) {
      if (existsSync(fileURLToPath(url) + suffix)) return nextResolve(url.href + suffix, context)
    }
  }
  return nextResolve(specifier, context)
}
