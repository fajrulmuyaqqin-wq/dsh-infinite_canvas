#!/usr/bin/env node
/**
 * 界面语言国际化与多语言完整度回归测试。
 *
 * 验证目标：
 *  1. 词典双向 100% 对齐：DICT_ZH 与 DICT_EN 所有 key 必须相互完全匹配，不允许孤立/缺失翻译。
 *  2. 印尼语 (id) 扩展覆盖：DICT_ID 继承自 DICT_EN，核心关键节点与面板名覆盖完整。
 *  3. 语言判定与回退阶梯（effLang 与 T）：
 *     - zh / zh-CN / zh-TW -> zh
 *     - id / in-ID -> id
 *     - en / en-US -> en
 *     - 其他非中语言（如 ja/de/fr）统一回落到英文 en，绝不泄漏中文
 *  4. 负向门禁（禁止倒置判定）：
 *     - client.js 中严禁出现 effLang() !== 'en' 或 effLang() != 'en'
 *     - 严禁出现 effLang() === 'en' ? en : zh 形式的倒置回退（会导致 id 等其他语言显示中文）
 *
 * 运行：node scripts/test-locale-completeness.mjs （退出码 0 = 通过）
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };

// ---------------- 1. 词典 key 提取与双向对齐 ----------------
const zhMatch = src.match(/const DICT_ZH = \{([\s\S]*?)\n    \};/);
const enMatch = src.match(/const DICT_EN = \{([\s\S]*?)\n    \};/);
const idMatch = src.match(/const DICT_ID = Object\.assign\(\{\}, DICT_EN, \{([\s\S]*?)\n    \}\);/);

ok(!!zhMatch, '无法在 client.js 中解析到 DICT_ZH 词典定义');
ok(!!enMatch, '无法在 client.js 中解析到 DICT_EN 词典定义');
ok(!!idMatch, '无法在 client.js 中解析到 DICT_ID 词典定义');

function extractDict(body) {
  const dict = {};
  const re = /'([^']+)':\s*('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/g;
  let m;
  while ((m = re.exec(body))) {
    try {
      dict[m[1]] = eval(m[2]);
    } catch {
      dict[m[1]] = m[2];
    }
  }
  return dict;
}

let totalAlignedCount = 0;
if (zhMatch && enMatch) {
  const zh = extractDict(zhMatch[1]);
  const en = extractDict(enMatch[1]);
  const zhKeys = Object.keys(zh);
  const enKeys = Object.keys(en);
  totalAlignedCount = zhKeys.length;

  ok(zhKeys.length > 500, 'DICT_ZH 提取条目数异常偏少（' + zhKeys.length + '）');
  ok(enKeys.length > 500, 'DICT_EN 提取条目数异常偏少（' + enKeys.length + '）');

  const missingInEn = zhKeys.filter((k) => !(k in en));
  const missingInZh = enKeys.filter((k) => !(k in zh));

  ok(missingInEn.length === 0, 'DICT_EN 缺失以下 ' + missingInEn.length + ' 个键：' + missingInEn.slice(0, 10).join(', '));
  ok(missingInZh.length === 0, 'DICT_ZH 缺失以下 ' + missingInZh.length + ' 个键：' + missingInZh.slice(0, 10).join(', '));

  // 验证关键新增词条存在
  const criticalKeys = [
    'lblDialogue', 'lblSfx', 'lblShot', 'dirActionSaveFail',
    'voiceManual', 'voiceExtractSrc', 'voiceExtractDone',
    'refReorderHint', 'reqPreviewFail', 'dirCustomAction',
    'errNodeNoInput', 'errSourceNoOutput', 'errSelfConnect', 'errPortMismatch'
  ];
  for (const k of criticalKeys) {
    ok(k in zh, 'DICT_ZH 缺少关键键: ' + k);
    ok(k in en, 'DICT_EN 缺少关键键: ' + k);
  }
}

// ---------------- 2. 印尼语 DICT_ID 继承验证 ----------------
if (idMatch) {
  const idDict = extractDict(idMatch[1]);
  ok('panel' in idDict, 'DICT_ID 缺少 panel 翻译');
  ok('run' in idDict, 'DICT_ID 缺少 run 翻译');
  ok('projects' in idDict, 'DICT_ID 缺少 projects 翻译');
  ok('assets' in idDict, 'DICT_ID 缺少 assets 翻译');
}

// ---------------- 3. 语言判定与回退阶梯函数测试 ----------------
{
  const localeSlice = (() => {
    const start = src.indexOf('function localeIdOf');
    const end = src.indexOf('function T(k)', start);
    const end2 = src.indexOf('\n    }', end);
    return src.slice(start, end2 + 6);
  })();

  const sandbox = {
    document: { documentElement: { lang: '' } },
    CTX: null,
    LANG_OVERRIDE: null,
    DICT_ZH: zhMatch ? extractDict(zhMatch[1]) : {},
    DICT_EN: enMatch ? extractDict(enMatch[1]) : {},
    DICT_ID: idMatch ? extractDict(idMatch[1]) : {},
  };

  const fnFactory = new Function('sandbox', `
    with (sandbox) {
      ${localeSlice}
      return { localeIdOf, hostLang, effLang, T };
    }
  `);

  const { localeIdOf, hostLang, effLang, T } = fnFactory(sandbox);

  // 测试 localeIdOf 格式兼容
  ok(localeIdOf({ active: 'zh-CN' }) === 'zh-CN', 'localeIdOf 未识别 {active: "zh-CN"}');
  ok(localeIdOf({ active: 'en-US' }) === 'en-US', 'localeIdOf 未识别 {active: "en-US"}');
  ok(localeIdOf({ active: 'id-ID' }) === 'id-ID', 'localeIdOf 未识别 {active: "id-ID"}');
  ok(localeIdOf('en') === 'en', 'localeIdOf 未识别字符串形态');

  // 测试 hostLang 回落阶梯
  sandbox.CTX = { locale: { getLocale: () => ({ active: 'zh' }) } };
  ok(hostLang() === 'zh', 'hostLang("zh") !== "zh"');

  sandbox.CTX = { locale: { getLocale: () => ({ active: 'en-US' }) } };
  ok(hostLang() === 'en', 'hostLang("en-US") !== "en"');

  sandbox.CTX = { locale: { getLocale: () => ({ active: 'id' }) } };
  ok(hostLang() === 'id', 'hostLang("id") !== "id"');

  sandbox.CTX = { locale: { getLocale: () => ({ active: 'in-ID' }) } };
  ok(hostLang() === 'id', 'hostLang("in-ID") !== "id"');

  sandbox.CTX = { locale: { getLocale: () => ({ active: 'ja' }) } };
  ok(hostLang() === 'en', '非中非印语言（如 ja）应默认回落到 en，实际为 ' + hostLang());

  // 测试 T(k) 翻译与回退
  sandbox.CTX = { locale: { getLocale: () => ({ active: 'zh' }) } };
  ok(T('projects') === '项目', '中文环境下 T("projects") 应为 "项目"');

  sandbox.CTX = { locale: { getLocale: () => ({ active: 'en' }) } };
  ok(T('projects') === 'Projects', '英文环境下 T("projects") 应为 "Projects"');

  sandbox.CTX = { locale: { getLocale: () => ({ active: 'id' }) } };
  ok(T('projects') === 'Proyek', '印尼语环境下 T("projects") 应为 "Proyek"');

  // 验证连线错误在各语言下的翻译
  ok(T('errNodeNoInput') === 'Simpul ini tidak memiliki port input', '印尼语 T("errNodeNoInput") 翻译异常');
  sandbox.CTX = { locale: { getLocale: () => ({ active: 'en' }) } };
  ok(T('errNodeNoInput') === 'This node has no input port', '英语 T("errNodeNoInput") 翻译异常');
  sandbox.CTX = { locale: { getLocale: () => ({ active: 'zh' }) } };
  ok(T('errNodeNoInput') === '该节点没有输入端口', '中文 T("errNodeNoInput") 翻译异常');

  // 印尼语未显式重写时应优雅回落到英文，不能直接跳到中文
  sandbox.CTX = { locale: { getLocale: () => ({ active: 'id' }) } };
  ok(T('dirActionSaveFail') === 'Save failed', '印尼语未定义 key 应回落到英文，实际：' + T('dirActionSaveFail'));

  // 英文未定义键不能返回中文
  sandbox.CTX = { locale: { getLocale: () => ({ active: 'en' }) } };
  ok(T('nonExistentKey') === 'nonExistentKey', '不存在键应返回原 key');
}

// ---------------- 4. 负向门禁：杜绝倒置语言判定 ----------------
{
  // 检查是否出现 effLang() !== 'en' 或 effLang() != 'en'
  const notEn1 = src.match(/effLang\(\)\s*!==\s*['"]en['"]/g);
  const notEn2 = src.match(/effLang\(\)\s*!=\s*['"]en['"]/g);
  ok(!notEn1, '发现禁止的倒置判定 effLang() !== "en"，会导致非 en 语言误入中文分支');
  ok(!notEn2, '发现禁止的倒置判定 effLang() != "en"，会导致非 en 语言误入中文分支');

  // 检查是否出现 effLang() === 'en' ? en : zh 判定
  const ternaryMatches = src.match(/effLang\(\)\s*===\s*['"]en['"]\s*\?\s*[^:]+:\s*[^;\n,)]+/g) || [];
  ok(ternaryMatches.length === 0, '发现倒置三元判定 effLang() === "en" ? en : zh：' + ternaryMatches.join('; '));
}

if (errs.length) {
  console.error('✗ 语言国际化完整度测试未通过（' + errs.length + ' 项）：');
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}

console.log('✓ 语言国际化完整度测试全部通过（' + totalAlignedCount + ' 个中英词条 100% 对齐 / 印尼语阶梯回退 / 杜绝倒置语言判定）');
process.exit(0);
