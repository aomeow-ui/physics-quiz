/**
 * 题库构建与校验脚本
 *   node tools/build-bank.mjs
 *
 * 作用：
 *   1. 读取 data/bank-*.json（各知识点分卷）
 *   2. 逐题校验结构、答案合法性、重复 id、LaTeX 残留等问题
 *   3. 输出 data/questions.js（浏览器直接可用）和 data/questions.json（合并后的纯 JSON）
 *   4. 打印统计报告
 *
 * 有硬性错误时以非 0 退出码结束，方便排查。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TOPICS = ['力学', '电磁学', '热学', '光学', '近代物理'];
const SOURCE_TYPES = ['真题', '真题改编', '模拟题', '自编'];

const errors = [];
const warnings = [];

function normalize(raw, file, index) {
  const where = `${file}[${index}]`;
  if (!raw || typeof raw !== 'object') { errors.push(`${where}: 不是对象`); return null; }
  const q = {};

  q.stem = String(raw.stem || raw.question || '').trim();
  if (!q.stem) errors.push(`${where}: 缺少题干`);

  const opts = raw.options || [];
  if (!Array.isArray(opts) || opts.length < 2) { errors.push(`${where}: options 必须是不少于 2 项的数组`); return null; }
  q.options = opts.map((o, i) => {
    if (o && typeof o === 'object') {
      return { key: String(o.key || KEYS[i]).trim().toUpperCase(), text: String(o.text || '').trim() };
    }
    return { key: KEYS[i], text: String(o == null ? '' : o).trim() };
  });
  const keySet = new Set(q.options.map(o => o.key));
  if (keySet.size !== q.options.length) errors.push(`${where}: 选项 key 有重复`);
  q.options.forEach((o, i) => {
    if (!o.text) errors.push(`${where}: 第 ${i + 1} 个选项内容为空`);
  });

  let ans = raw.answer;
  if (Array.isArray(ans)) ans = ans.slice();
  else if (typeof ans === 'string') ans = ans.toUpperCase().split(/[,、\s]+/).filter(Boolean);
  else if (typeof ans === 'number') ans = [ans];
  else ans = [];
  ans = [...new Set(ans.map(a => (typeof a === 'number' ? KEYS[a] : String(a).trim().toUpperCase())))];
  if (!ans.length) errors.push(`${where}: 缺少答案`);
  ans.forEach(a => {
    if (!keySet.has(a)) errors.push(`${where}: 答案 "${a}" 不在选项中`);
  });
  q.answer = ans;

  q.type = (raw.type === 'multiple' || raw.type === 'multi' || ans.length > 1) ? 'multiple' : 'single';
  if (q.type === 'single' && ans.length > 1) {
    warnings.push(`${where}: type 写的是 single 但有多个答案，已按 multiple 处理`);
    q.type = 'multiple';
  }
  if (q.type === 'multiple' && ans.length === q.options.length) {
    warnings.push(`${where}: 多选答案等于全部选项（${ans.length} 个），建议修改`);
  }
  if (q.type === 'multiple' && ans.length < 2) errors.push(`${where}: 多选题答案少于 2 个`);

  q.id = String(raw.id || '').trim();
  if (!q.id) errors.push(`${where}: 缺少 id`);

  q.topic = String(raw.topic || '').trim();
  if (!TOPICS.includes(q.topic)) warnings.push(`${where}: topic "${q.topic}" 不在标准知识点内`);

  let tags = raw.tags || [];
  if (typeof tags === 'string') tags = tags.split(/[,，、;；\s]+/).filter(Boolean);
  q.tags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [];

  q.explanation = String(raw.explanation || '').trim();
  if (!q.explanation) { errors.push(`${where}: 缺少解析`); q.explanation = ''; }
  if (q.explanation && q.explanation.length < 20) warnings.push(`${where}: 解析过短（${q.explanation.length} 字）`);

  q.source = String(raw.source || '').trim();
  if (!q.source) warnings.push(`${where}: 未标注来源`);

  q.sourceType = String(raw.sourceType || '').trim();
  if (!SOURCE_TYPES.includes(q.sourceType)) {
    warnings.push(`${where}: sourceType "${q.sourceType}" 不规范，应为 真题/真题改编/模拟题/自编`);
  }
  // 来源诚实性护栏：声称是真题就必须能核对到年份
  if ((q.sourceType === '真题' || q.sourceType === '真题改编') && !/(19|20)\d{2}/.test(q.source)) {
    warnings.push(`${where}: sourceType 标为「${q.sourceType}」，但 source 里没有可核对的年份 —— 请补全年份与卷别，或改标为「模拟题」/「自编」`);
  }

  const d = parseInt(raw.difficulty, 10);
  q.difficulty = (d >= 1 && d <= 5) ? d : 3;
  if (!(d >= 1 && d <= 5)) warnings.push(`${where}: difficulty 不是 1–5，已置为 3`);

  // LaTeX 残留检查
  const allText = q.stem + ' ' + q.options.map(o => o.text).join(' ') + ' ' + q.explanation;
  if (/\$[^$]+\$|\\frac|\\times|\\sqrt|\\Delta|\\[a-zA-Z]+\{/.test(allText)) {
    warnings.push(`${where}: 疑似残留 LaTeX 语法，手机端不会渲染，请改成 Unicode 字符`);
  }

  return q;
}

/* --------------------------------------------------------------- 读取 */
if (!existsSync(DATA)) {
  console.error('data/ 目录不存在');
  process.exit(1);
}

const files = readdirSync(DATA).filter(f => /^bank-.*\.json$/.test(f)).sort();
if (!files.length) {
  console.error('data/ 下没有找到 bank-*.json 文件');
  process.exit(1);
}

const all = [];
const seenIds = new Map();
const seenStems = new Map();

for (const file of files) {
  const full = join(DATA, file);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(full, 'utf8'));
  } catch (e) {
    errors.push(`${file}: JSON 解析失败 — ${e.message}`);
    continue;
  }
  if (!Array.isArray(parsed)) {
    errors.push(`${file}: 顶层必须是数组`);
    continue;
  }
  parsed.forEach((raw, i) => {
    const q = normalize(raw, file, i);
    if (!q) return;
    if (seenIds.has(q.id)) errors.push(`${file}[${i}]: id "${q.id}" 与 ${seenIds.get(q.id)} 重复`);
    else seenIds.set(q.id, `${file}[${i}]`);
    const stemKey = q.stem.replace(/\s+/g, '');
    if (seenStems.has(stemKey)) warnings.push(`${file}[${i}]: 题干与 ${seenStems.get(stemKey)} 重复`);
    else seenStems.set(stemKey, `${file}[${i}]`);
    all.push(q);
  });
}

/* --------------------------------------------------------------- 输出 */
if (all.length) {
  const header = `/* 自动生成，请勿直接编辑。\n`
    + `   源文件：data/bank-*.json\n`
    + `   重新生成：node tools/build-bank.mjs\n`
    + `   生成时间：${new Date().toISOString()}\n`
    + `   题目总数：${all.length}\n*/\n`;
  // App 运行时加载的就是这个文件：压缩输出以减小体积与解析时间
  const payload = 'window.PHYSICS_BANK = ' + JSON.stringify(all) + ';\n';
  writeFileSync(join(DATA, 'questions.js'), header + payload, 'utf8');
  // 另一个是给人看的版本，保留缩进
  writeFileSync(join(DATA, 'questions.json'), JSON.stringify(all, null, 2) + '\n', 'utf8');
}

/* --------------------------------------------------------------- 报告 */
const by = (fn) => {
  const m = new Map();
  all.forEach(q => m.set(fn(q), (m.get(fn(q)) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log('\n===== 题库构建报告 =====');
console.log(`分卷文件：${files.join(', ')}`);
console.log(`题目总数：${all.length}`);
console.log(`题型：${by(q => q.type === 'multiple' ? '多选' : '单选').map(([k, v]) => `${k} ${v}`).join('　')}`);
console.log(`知识点：${by(q => q.topic).map(([k, v]) => `${k} ${v}`).join('　')}`);
console.log(`来源类型：${by(q => q.sourceType).map(([k, v]) => `${k} ${v}`).join('　')}`);
console.log(`难度分布：${by(q => '难度' + q.difficulty).map(([k, v]) => `${k} ${v}`).join('　')}`);
console.log(`答案分布：${by(q => q.answer.join('')).slice(0, 12).map(([k, v]) => `${k}:${v}`).join('　')}`);

// 各知识点单选题的答案字母分布：某字母占比过高会让学生靠"蒙"得分
console.log('\n各知识点单选答案字母分布（理想情况四个字母大致均衡）：');
for (const topic of [...new Set(all.map(q => q.topic))]) {
  const singles = all.filter(q => q.topic === topic && q.type === 'single');
  if (!singles.length) continue;
  const c = { A: 0, B: 0, C: 0, D: 0 };
  singles.forEach(q => { if (c[q.answer[0]] !== undefined) c[q.answer[0]] += 1; });
  const max = Math.max(...Object.values(c));
  const flag = singles.length >= 8 && max / singles.length > 0.45 ? '  ← 偏集中，建议调整选项顺序' : '';
  console.log(`  ${topic.padEnd(6)} 单选 ${String(singles.length).padStart(2)} 题　` +
    Object.keys(c).map(k => `${k}:${c[k]}`).join('　') + flag);
}

if (warnings.length) {
  console.log(`\n----- 提醒 ${warnings.length} 条 -----`);
  warnings.slice(0, 60).forEach(w => console.log('  · ' + w));
  if (warnings.length > 60) console.log(`  …另有 ${warnings.length - 60} 条`);
}

if (errors.length) {
  console.log(`\n----- 错误 ${errors.length} 条 -----`);
  errors.slice(0, 60).forEach(e => console.log('  ✗ ' + e));
  if (errors.length > 60) console.log(`  …另有 ${errors.length - 60} 条`);
  console.log('\n构建未通过：请修正上述错误后重试。');
  process.exit(1);
}

console.log('\n✓ 校验通过，已写出 data/questions.js 与 data/questions.json');
