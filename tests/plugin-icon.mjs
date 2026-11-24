import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

assert.equal(pkg.icon, './icon.svg', 'package.json should declare top-level icon')
assert.ok(Array.isArray(pkg.files) && pkg.files.includes('icon.svg'), 'package.json files should include icon.svg')

const iconPath = join(repoRoot, 'icon.svg')
const bytes = statSync(iconPath).size
assert.ok(bytes > 0, 'icon.svg should be non-empty')
assert.ok(bytes <= 256 * 1024, 'icon.svg should stay within 256 KiB')

const svg = readFileSync(iconPath, 'utf8')
assert.match(svg, /width="36"/)
assert.match(svg, /height="36"/)
assert.match(svg, /viewBox="0 0 36 36"/)
// DSH 插件管理页以图片方式加载图标，禁止脚本、外链、样式块与文本节点。
assert.doesNotMatch(svg, /<(?:script|style|text|image|foreignObject)\b/i)
assert.doesNotMatch(svg, /\son[a-z]+\s*=/i)

console.log('plugin icon: all assertions passed')
