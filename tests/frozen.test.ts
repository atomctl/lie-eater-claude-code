import { expect, test } from 'claude-code/testing'

import { classify, decidesHowChecksRun, hash, isFrozen, keep, newChecks } from '../hooks/lib/frozen'
import type { Kept } from '../types'

const T = 'tests/test_cart.py'
const J = 'tests/cart.test.ts'
const PY = 'def test_total():\n    assert total([10, 20]) == 30\n\n\ndef test_empty():\n    assert total([]) == 0\n'
const JS = "it('totals', () => {\n  expect(cart.total).toBe(30)\n})\n\nit('is empty', () => {\n  expect(empty.total).toBe(0)\n})\n"
const kept = (files: Record<string, string>): Record<string, Kept> =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [path, keep(path, text)]))
/** What became of one check file: frozen as `was`, now `now` (undefined: gone). */
const one = (file: string, was: string, now: string | undefined) =>
  classify(kept({ [file]: was }), now === undefined ? {} : kept({ [file]: now }), now === undefined ? [] : [file])

// ---- the red-team table: each attack row must now be a changed check file ----

test('a check swapped for a weaker one is a changed check file', async () => {
  expect(one(J, JS, JS.replace('toBe(30)', 'toBe(true)').replace('cart.total', 'true'))).toEqual([
    { file: J, how: 'changed', n: 1, lost: ['  expect(cart.total).toBe(30)'] },
  ])
})

test('a check put inside a block comment is a changed check file', async () => {
  const commented = JS.replace('  expect(cart.total).toBe(30)\n', '  /*\n  expect(cart.total).toBe(30)\n  */\n')
  expect(one(J, JS, commented)).toMatchObject([{ file: J, how: 'changed', n: 2 }])
})

test('a skipif(True) mark added on its own line is a changed check file', async () => {
  expect(one(T, PY, `@pytest.mark.skipif(True, reason="later")\n${PY}`)).toMatchObject([{ file: T, how: 'changed', n: 1, lost: [] }])
})

test('a return in front of an assert is a changed check file', async () => {
  expect(one(T, PY, PY.replace('    assert total([10', '    return\n    assert total([10'))).toMatchObject([{ file: T, how: 'changed', n: 1 }])
})

test('a table added and a check dropped is a changed check file', async () => {
  const table = "\nit.each([[1, 1]])('doubles %i', (a, b) => {\n  expect(a).toBe(b)\n})\n"
  expect(one(J, JS, `${JS.replace('  expect(empty.total).toBe(0)\n', '')}${table}`)).toMatchObject([
    { file: J, how: 'changed', lost: ['  expect(empty.total).toBe(0)'] },
  ])
})

// ---- honest work ----

test('existing check files are frozen: a line added anywhere is a change, with the lines counted', async () => {
  // a test added at the end
  const more = "\nit('adds tax', () => {\n  expect(taxed.total).toBe(33)\n})\n"
  expect(one(J, JS, `${JS}${more}`)).toEqual([{ file: J, how: 'changed', n: 4, lost: [] }])
  // `test_total = test_empty` appended: the old test now runs the other one
  expect(one(T, PY, `${PY}test_total = test_empty\n`)).toEqual([{ file: T, how: 'changed', n: 1, lost: [] }])
  // `|| true` put in front of a closing bracket
  const ok = "it('totals', () => {\n  assert.ok(\n    actual\n  )\n})\n"
  expect(one(J, ok, ok.replace('    actual\n', '    actual\n    || true\n'))).toEqual([{ file: J, how: 'changed', n: 1, lost: [] }])
  // a deleted final line break
  expect(one(T, PY, PY.trimEnd())).toEqual([{ file: T, how: 'changed', n: 1, lost: [] }])
  // a new line glued to the old last line alters that line
  expect(one(T, PY.trimEnd(), `${PY.trimEnd()} or True\n`)).toMatchObject([{ file: T, how: 'changed', lost: ['    assert total([]) == 0'] }])
})

test('a check file as it was, or put back to its original text, is no change', async () => {
  expect(one(J, JS, JS)).toEqual([])
})

test('a new check file is free; a gone one is "moved or deleted"', async () => {
  expect(classify(kept({ [J]: JS }), kept({ [J]: JS, 'tests/more.test.ts': JS }), [J, 'tests/more.test.ts'])).toEqual([])
  expect(one(J, JS, undefined)).toEqual([{ file: J, how: 'gone' }])
})

// ---- the files that decide how checks run ----

test('any change to a file that decides how the checks run is "config"; a new one too', async () => {
  const pkg = '{"name":"x","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"4.0.0"}}'
  expect(one('package.json', pkg, pkg.replace('vitest run', 'node -e 0'))).toEqual([{ file: 'package.json', how: 'config' }])
  expect(one('pytest.ini', '[pytest]\n', '[pytest]\naddopts = -k cart\n')).toEqual([{ file: 'pytest.ini', how: 'config' }])
  expect(one('pytest.ini', '[pytest]\n', undefined)).toEqual([{ file: 'pytest.ini', how: 'config' }])
  // a dependency added changes no check
  expect(one('package.json', pkg, pkg.replace('"4.0.0"', '"4.0.0","zod":"4.1.0"'))).toEqual([])
  // a new conftest.py anywhere, unless it was there (and could not be read) when armed
  expect(classify({}, {}, ['tests/conftest.py'])).toEqual([{ file: 'tests/conftest.py', how: 'config' }])
  expect(classify({}, {}, ['tests/conftest.py'], ['tests/conftest.py'])).toEqual([])
  // appending to conftest.py is still a change of how the checks run
  expect(one('tests/conftest.py', 'import pytest\n', 'import pytest\n\n@pytest.fixture\ndef cart():\n    return []\n')).toEqual([
    { file: 'tests/conftest.py', how: 'config' },
  ])
})

test('which files are frozen', async () => {
  for (const path of ['tests/helpers.ts', 'tests/data/cart.json', 'src/__tests__/a.test.ts', 'spec/x_spec.rb', 'cart_test.go', 'test_cart.py', 'package.json', 'api/conftest.py', 'jest.config.js', 'vitest.config.mts', '.mocharc.yml', 'playwright.config.ts', 'Makefile', 'tox.ini', 'setup.cfg', 'pyproject.toml']) {
    expect(`${path} ${isFrozen(path)}`).toBe(`${path} true`)
  }
  for (const path of ['src/cart.ts', 'README.md', 'src/helpers.ts', 'contest.py']) {
    expect(`${path} ${isFrozen(path)}`).toBe(`${path} false`)
  }
  expect(decidesHowChecksRun('tests/conftest.py')).toBe(true)
  expect(decidesHowChecksRun('tests/helpers.py')).toBe(false)
})

test('a big file is kept as a hash and its length; a change to it is still seen', async () => {
  const big = `${'x'.repeat(200_001)}\n`
  expect(keep(J, big)).toEqual({ hash: hash(big) })
  expect(one(J, big, `${big}y\n`)).toEqual([{ file: J, how: 'changed' }])
  expect(one(J, big, big)).toEqual([])
  expect(hash('a')).not.toBe(hash('b'))
})

// ---- where new lines may stand: nowhere in an existing check file (review of 20 Nov, round 2) ----

const DESCRIBED = "import { expect, it, describe } from 'vitest'\nimport { cart } from '../src/cart'\n\ndescribe('cart', () => {\n  it('totals', () => {\n    expect(cart.total).toBe(30)\n  })\n})\n"

test('a test put inside a describe block, or an import added at the top, is a change', async () => {
  const inside = DESCRIBED.replace("  })\n})\n", "  })\n\n  it('adds tax', () => {\n    expect(cart.taxed).toBe(33)\n  })\n})\n")
  expect(one(J, DESCRIBED, inside)).toEqual([{ file: J, how: 'changed', n: 4, lost: [] }])
  expect(one(J, DESCRIBED, DESCRIBED.replace('import { cart }', "import { tax } from '../src/tax'\nimport { cart }"))).toEqual([
    { file: J, how: 'changed', n: 1, lost: [] },
  ])
})

test('a line put in front of an old check is a change', async () => {
  // an early return in front of the check
  expect(one(J, DESCRIBED, DESCRIBED.replace('    expect(cart', '    return\n    expect(cart'))).toMatchObject([{ file: J, how: 'changed' }])
  // a skip mark in front of a Python test
  expect(one(T, PY, PY.replace('def test_empty', '@pytest.mark.skipif(True, reason="x")\ndef test_empty'))).toMatchObject([{ file: T, how: 'changed' }])
})

// ---- the second attack round (20 Nov, DeepSeek) ----

test('pyproject.toml and setup.cfg: only the parts that decide the checks count', async () => {
  const P = 'pyproject.toml'
  const was = '[project]\nname = "cart"\ndependencies = []\n\n[tool.pytest.ini_options]\naddopts = "-q"\n\n[tool.ruff]\nline-length = 100\n'
  expect(one(P, was, was.replace('dependencies = []', 'dependencies = ["requests"]').replace('100', '120'))).toEqual([])
  expect(one(P, was, was.replace('addopts = "-q"', 'addopts = "-q -k cart"'))).toEqual([{ file: P, how: 'config' }])
  expect(one(P, was, `${was}\n[tool.coverage.run]\nomit = ["*"]\n`)).toEqual([{ file: P, how: 'config' }])
  const cfg = '[metadata]\nname = cart\n\n[tool:pytest]\naddopts = -q\n'
  expect(one('setup.cfg', cfg, cfg.replace('name = cart', 'name = shop'))).toEqual([])
  expect(one('setup.cfg', cfg, cfg.replace('addopts = -q', 'addopts = -q -k cart'))).toEqual([{ file: 'setup.cfg', how: 'config' }])
})

test('more files decide how the checks run; a dependency list does not', async () => {
  for (const path of ['vite.config.ts', 'web/vite.config.mjs', 'karma.conf.js', 'phpunit.xml', 'phpunit.xml.dist', 'noxfile.py', '.rspec']) {
    expect(`${path}: ${decidesHowChecksRun(path)}`).toBe(`${path}: true`)
  }
  for (const path of ['go.mod', 'Cargo.toml', 'requirements.txt', 'tsconfig.json']) {
    expect(`${path}: ${decidesHowChecksRun(path)}`).toBe(`${path}: false`)
  }
})

// ---- the third round (20 Nov, GPT 6.2 and DeepSeek round 2) ----

test('package.json: only the test scripts and the keys that decide how tests load count', async () => {
  const pkg = '{"type":"module","scripts":{"test":"vitest run","lint":"eslint .","build":"tsc"}}'
  const P = 'package.json'
  expect(one(P, pkg, pkg.replace('eslint .', 'eslint src').replace('"tsc"', '"tsc -b"'))).toEqual([])
  expect(one(P, pkg, pkg.replace('"lint"', '"pretest":"node -e 0","lint"'))).toEqual([{ file: P, how: 'config' }])
  expect(one(P, pkg, pkg.replace('"lint"', '"posttest":"node -e 0","lint"'))).toEqual([{ file: P, how: 'config' }])
  expect(one(P, pkg, pkg.replace('"module"', '"commonjs"'))).toEqual([{ file: P, how: 'config' }])
  expect(one(P, pkg, pkg.replace('"type"', '"imports":{"#cart":"./fake.js"},"type"'))).toEqual([{ file: P, how: 'config' }])
})

test('GNUmakefile and makefile decide how the checks run: a new one is "config"', async () => {
  for (const path of ['GNUmakefile', 'makefile', 'api/GNUmakefile']) {
    expect(`${path}: ${decidesHowChecksRun(path)}`).toBe(`${path}: true`)
  }
  expect(classify({}, {}, ['GNUmakefile'])).toEqual([{ file: 'GNUmakefile', how: 'config' }])
})

test('the hash is 64 bits and the length: two texts that collide under 32-bit FNV-1a do not hash alike', async () => {
  const tail = 'x'.repeat(200_000)
  const fnv32 = (text: string): number => {
    let h = 0x811c9dc5
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)

    return h >>> 0
  }
  const a = `\u9dc5a${tail}`
  const b = `\u3f3a\u970c${tail}`
  // the pair of the review collides under the old hash...
  expect(fnv32(a)).toBe(fnv32(b))
  // ...and not under this one
  expect(hash(a)).not.toBe(hash(b))
  expect(hash(a)).toMatch(/^[0-9a-f]{16}:200002$/)
  expect(one(J, a, b)).toEqual([{ file: J, how: 'changed' }])
})

// ---- the third review round (20 Nov, GPT 6.2 and DeepSeek) ----

test('a new check file is free, but not one that runs only some of the checks (`.only`)', async () => {
  const was = kept({ [J]: JS })
  const only = "it.only('one', () => {\n  expect(1).toBe(1)\n})\n"
  for (const [name, text] of [['tests/new.test.ts', only], ['tests/f.test.ts', only.replace('it.only(', 'fit(')], ['tests/d.test.ts', only.replace('it.only(', 'fdescribe(')]] as const) {
    expect(classify(was, kept({ [J]: JS, [name]: text }), [J, name])).toEqual([{ file: name, how: 'only' }])
  }
  expect(classify(was, kept({ [J]: JS, 'tests/new.test.ts': only.replace('it.only(', 'it(') }), [J, 'tests/new.test.ts'])).toEqual([])
})

test('a frozen check file that is still listed but cannot be read now is not "gone"', async () => {
  expect(classify(kept({ [J]: JS }), {}, [J], [J])).toEqual([])
  expect(classify(kept({ [J]: JS }), {}, [], [])).toEqual([{ file: J, how: 'gone' }])
})

test('setup files of the runners decide how the checks run too', async () => {
  for (const path of ['jest.setup.js', 'vitest.setup.ts', 'src/setupTests.ts', 'babel.config.js', '.babelrc', '.nycrc', '.nycrc.json', '.coveragerc']) {
    expect(`${path}: ${decidesHowChecksRun(path)}`).toBe(`${path}: true`)
  }
})

test('new check files: test-named files and files in a test folder that are not in the frozen set; never a file that decides how checks run', async () => {
  const was = { files: { 'tests/test_cart.py': { text: 'x' }, 'pyproject.toml': { text: '' } }, unread: ['tests/big.py'] }
  const names = ['cart.py', 'tests/test_cart.py', 'tests/big.py', 'tests/test_tax.py', 'tests/helpers.py', 'src/b.test.ts', 'tests/conftest.py', 'pyproject.toml', 'notes.md']

  // sorted, so that "the first" is always the same file; a helper in a test folder counts
  expect(newChecks(was, names)).toEqual(['src/b.test.ts', 'tests/helpers.py', 'tests/test_tax.py'])
  expect(newChecks(was, ['cart.py', 'tests/test_cart.py'])).toEqual([])
})
