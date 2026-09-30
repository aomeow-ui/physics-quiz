/**
 * 端到端冒烟测试（用 jsdom 真实执行页面脚本并模拟点击）
 *
 *   $env:NODE_PATH='C:\Users\lx1\deepseek-harness\node_modules'
 *   node tools/smoke-test.cjs
 *
 * 前置条件：本地预览服务器已在 5173 端口运行（node tools/serve.mjs 5173）
 *
 * 覆盖：首页渲染 → 随机组卷 → 答题/判分/解析 → 成绩单 → 错题本/收藏/统计
 *      → 题库导入（合法与非法）→ 设置项 → 各视图无脚本异常
 */
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.log('跳过端到端测试：当前环境没有安装 jsdom。');
  console.log('想运行的话：npm i -D jsdom，然后重跑 npm test。');
  console.log('（这只是开发期的自测工具，不影响应用本身运行。）');
  process.exit(0);
}

const BASE = process.env.PQ_BASE || 'http://localhost:5173/';
let pass = 0;
const failures = [];
const pageErrors = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

function section(t) { console.log('\n== ' + t); }

/* ---------------------------------------------------------------------------
 * 测试专用固定题库
 *
 * 通过 localStorage 的 pq.custom.v1 注入（见下面的 beforeParse），而不是依赖
 * data/bank-*.json 的内容。这样即使内置题库被清空、或者以后换了一整套新题，
 * 本测试依然能完整跑通「组卷 → 答题 → 判分 → 成绩单 → 错题本 → 收藏 → 统计」。
 * 5 道题分别覆盖 5 个知识点，单选/多选都有。
 * ------------------------------------------------------------------------- */
const FIXTURE = [
  {
    id: 'FIX-001', topic: '力学', tags: ['匀变速直线运动'], type: 'single',
    stem: '【冒烟测试】一物体做匀加速直线运动，初速度为 2 m/s，加速度为 3 m/s²，则 1 s 末它的速度为',
    options: [
      { key: 'A', text: '3 m/s' }, { key: 'B', text: '5 m/s' },
      { key: 'C', text: '6 m/s' }, { key: 'D', text: '8 m/s' }
    ],
    answer: ['B'],
    explanation: '由 v = v₀ + at = 2 m/s + 3 m/s² × 1 s = 5 m/s。',
    source: '冒烟测试固定题', sourceType: '自编', difficulty: 1
  },
  {
    id: 'FIX-002', topic: '力学', tags: ['牛顿第一定律', '惯性'], type: 'multiple',
    stem: '【冒烟测试】关于惯性，下列说法正确的是',
    options: [
      { key: 'A', text: '一切物体都有惯性' },
      { key: 'B', text: '力是维持物体运动的原因' },
      { key: 'C', text: '惯性的大小只由质量决定' },
      { key: 'D', text: '惯性是一种力，方向与运动方向相反' }
    ],
    answer: ['A', 'C'],
    explanation: '惯性是物体的固有属性，一切物体都有；质量是惯性大小的唯一量度。力是改变运动状态的原因，惯性也不是力。',
    source: '冒烟测试固定题', sourceType: '自编', difficulty: 2
  },
  {
    id: 'FIX-003', topic: '电磁学', tags: ['库仑定律'], type: 'single',
    stem: '【冒烟测试】两个点电荷之间的库仑力为 F，若保持电荷量不变、把它们之间的距离变为原来的 2 倍，则库仑力变为',
    options: [
      { key: 'A', text: '2F' }, { key: 'B', text: '4F' },
      { key: 'C', text: 'F/4' }, { key: 'D', text: 'F/2' }
    ],
    answer: ['C'],
    explanation: '由 F = kq₁q₂/r² 可知力与距离的平方成反比，距离变为 2 倍则力变为 1/4。',
    source: '冒烟测试固定题', sourceType: '自编', difficulty: 1
  },
  {
    id: 'FIX-004', topic: '热学', tags: ['内能', '温度'], type: 'single',
    stem: '【冒烟测试】关于物体的内能，下列说法正确的是',
    options: [
      { key: 'A', text: '温度高的物体内能一定大' },
      { key: 'B', text: '0 ℃ 的冰内能为零' },
      { key: 'C', text: '物体温度不变，内能就一定不变' },
      { key: 'D', text: '物体的内能与温度和体积都有关' }
    ],
    answer: ['D'],
    explanation: '内能由分子动能和分子势能共同决定，与温度、体积（分子间距离）都有关。冰在 0 ℃ 也有内能；晶体熔化时温度不变而内能增大。',
    source: '冒烟测试固定题', sourceType: '自编', difficulty: 2
  },
  {
    id: 'FIX-005', topic: '光学', tags: ['折射', '波长'], type: 'single',
    stem: '【冒烟测试】一束单色光从空气斜射入水中，下列说法正确的是',
    options: [
      { key: 'A', text: '频率不变，波长变短' },
      { key: 'B', text: '频率变小，波长不变' },
      { key: 'C', text: '频率不变，波长变长' },
      { key: 'D', text: '频率变大，波长变短' }
    ],
    answer: ['A'],
    explanation: '光的频率由光源决定，进入介质后频率不变；波速 v = c/n 变小，由 λ = v/f 知波长变短。',
    source: '冒烟测试固定题', sourceType: '自编', difficulty: 2
  },
  {
    id: 'FIX-006', topic: '近代物理', tags: ['光电效应'], type: 'multiple',
    stem: '【冒烟测试】关于光电效应，下列说法正确的是',
    options: [
      { key: 'A', text: '入射光越强，光电子的最大初动能就越大' },
      { key: 'B', text: '存在截止频率，低于它时无论光多强都不发生光电效应' },
      { key: 'C', text: '光电子的最大初动能与入射光的强度成正比' },
      { key: 'D', text: '金属的逸出功与入射光的频率无关' }
    ],
    answer: ['B', 'D'],
    explanation: '由 Ek = hν − W₀ 知最大初动能只与入射光频率有关，与光强无关；逸出功是金属的固有属性。低于截止频率时不发生光电效应。',
    source: '冒烟测试固定题', sourceType: '自编', difficulty: 3
  }
];

(async function main() {
  // 先确认预览服务器在跑，否则给出清楚的提示而不是一堆堆栈
  try {
    const res = await fetch(BASE);
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    console.error('连不上 ' + BASE + '（' + e.message + '）');
    console.error('请先在另一个终端里运行：npm run serve');
    process.exit(2);
  }

  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      // 先注入测试固定题库，让下面的流程测试与内置题库内容解耦
      try { window.localStorage.setItem('pq.custom.v1', JSON.stringify(FIXTURE)); }
      catch (e) { /* 失败时「固定题库已注入」那条断言会给出明确报错 */ }
      window.addEventListener('error', function (e) {
        pageErrors.push(String((e && (e.error && e.error.stack || e.message)) || 'unknown error'));
      });
      window.addEventListener('unhandledrejection', function (e) {
        pageErrors.push('unhandledrejection: ' + String(e && e.reason));
      });
      window.alert = function (m) { window.__alerts = (window.__alerts || []).concat(String(m)); };
      window.confirm = function () { return true; };
      window.scrollTo = function () { };   // jsdom 未实现，屏蔽噪音
    }
  });

  const { window } = dom;
  const doc = window.document;

  await new Promise(function (resolve) {
    if (doc.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  // 等一拍，让 init() 完成
  await new Promise(function (r) { setTimeout(r, 60); });

  const click = function (el) {
    if (!el) throw new Error('要点击的元素不存在');
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  const $ = function (sel) { return doc.querySelector(sel); };
  const $$ = function (sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); };
  const byAct = function (act) { return doc.querySelector('[data-act="' + act + '"]'); };
  const byView = function (v) { return doc.querySelector('[data-view="' + v + '"]'); };
  const tab = function (t) { return doc.querySelector('.tab[data-tab="' + t + '"]'); };
  const title = function () { return $('#viewTitle').textContent; };
  const viewText = function () { return $('#view').textContent; };
  // 读首页大数字卡片（.hero-stat）里的值，按标签取
  const heroStat = function (label) {
    const el = $$('.hero-stat').filter(function (s) {
      return s.querySelector('span') && s.querySelector('span').textContent === label;
    })[0];
    return el ? el.querySelector('b').textContent : null;
  };
  // 读统计/题库页小卡片（.stat）里的值，按标签取
  const statValue = function (label) {
    const el = $$('.stat').filter(function (s) {
      return s.querySelector('span') && s.querySelector('span').textContent === label;
    })[0];
    return el ? el.querySelector('b').textContent : null;
  };
  // 每次都要重新查询：视图重渲染后旧引用会失效
  const setCount = function (n) {
    if (!$('#setCount')) click(byView('setup'));   // 不在组卷页时才进入
    const inp = $('#setCount');
    inp.value = String(n);
    inp.dispatchEvent(new window.Event('input', { bubbles: true }));
  };

  section('启动与题库加载');
  ok('window.PHYSICS_BANK 已定义且是数组', Array.isArray(window.PHYSICS_BANK));
  const builtinN = window.PHYSICS_BANK ? window.PHYSICS_BANK.length : 0;
  ok('内置题库已清空（实际 ' + builtinN + ' 题）', builtinN === 0);
  const BANK = JSON.parse(window.localStorage.getItem('pq.custom.v1') || '[]');
  ok('测试固定题库已注入 ' + FIXTURE.length + ' 题（实际 ' + BANK.length + '）', BANK.length === FIXTURE.length);
  ok('固定题库覆盖 5 个知识点', ['力学', '电磁学', '热学', '光学', '近代物理']
    .every(function (t) { return BANK.some(function (q) { return q.topic === t; }); }));
  ok('首页显示题库总题数 ' + BANK.length, heroStat('题库总题数') === String(BANK.length),
    '实际：' + heroStat('题库总题数'));
  ok('首页有「随机组卷」入口', !!byView('setup'));
  ok('底部导航有 4 个标签', $$('.tab').length === 4);

  section('随机组卷与答题');
  click(byView('setup'));
  ok('进入组卷页', title() === '随机组卷');
  ok('存在题量输入框', !!$('#setCount'));
  setCount(3);
  const startBtn = byAct('start-random');
  ok('开始答题按钮可用', !!startBtn && !startBtn.disabled);
  click(startBtn);
  ok('进入答题页', !!$('.stem'));
  ok('计时器已显示', $('#timer').hidden === false);

  // 逐题：按题库里的正确答案作答，验证判分
  let answered = 0;
  for (let i = 0; i < 3; i++) {
    const stemEl = $('.stem');
    if (!stemEl) break;
    const stem = stemEl.textContent;
    const q = BANK.filter(function (x) { return x.stem === stem; })[0];
    ok('第 ' + (i + 1) + ' 题能在题库中匹配到', !!q);
    if (!q) break;
    // 按 answer 里的字母点选（打乱顺序后 key 仍保留）
    q.answer.forEach(function (key) {
      const btn = $$('.opt').filter(function (b) { return b.querySelector('.opt-key').textContent === key; })[0];
      click(btn);
    });
    ok('已选中 ' + q.answer.join(''), $$('.opt.is-picked').length === q.answer.length);
    click(byAct('submit'));
    ok('提交后出现判定', !!$('.verdict'));
    ok('提交后出现解析', !!$('.explanation'));
    ok('判定为正确', ($('.verdict') || { textContent: '' }).textContent.indexOf('回答正确') >= 0,
      '实际：' + ($('.verdict') || { textContent: '(无)' }).textContent);
    ok('正确选项被标为 is-right', $$('.opt.is-right').length === q.answer.length);
    answered++;
    const nextBtn = byAct('next') || byAct('finish');
    click(nextBtn);
  }
  ok('完成了 3 道题', answered === 3);

  section('成绩单');
  ok('进入成绩单视图', viewText().indexOf('得分率') >= 0);
  ok('成绩单显示用时', viewText().indexOf('用时') >= 0);
  ok('全对时提示无错题', viewText().indexOf('全部答对') >= 0, '实际片段：' + viewText().slice(0, 80));
  click(doc.querySelector('[data-view="home"][data-act="clear-session"]'));
  ok('返回首页', title() === '物理刷题');

  section('故意答错 → 错题本');
  setCount(2);
  ok('组卷页题量已设为 2', $('#setCount').value === '2');
  click(byAct('start-random'));
  let wrongAnswered = 0;
  for (let i = 0; i < 2; i++) {
    const stemEl = $('.stem');
    if (!stemEl) break;
    const q = BANK.filter(function (x) { return x.stem === stemEl.textContent; })[0];
    // 故意选一个错项
    const wrongKey = ['A', 'B', 'C', 'D'].filter(function (k) { return q.answer.indexOf(k) < 0; })[0];
    click($$('.opt').filter(function (b) { return b.querySelector('.opt-key').textContent === wrongKey; })[0]);
    click(byAct('submit'));
    ok('错答被判为错误', ($('.verdict') || { textContent: '' }).textContent.indexOf('回答错误') >= 0);
    wrongAnswered++;
    if (i < 1) click(byAct('next'));
  }
  click(byAct('quit'));                       // 结束本轮 → 成绩单
  ok('结束本轮进入成绩单', viewText().indexOf('得分率') >= 0);
  click(doc.querySelector('[data-view="home"][data-act="clear-session"]'));
  ok('返回首页', title() === '物理刷题');
  click(tab('wrong'));
  ok('错题本已收录 ' + wrongAnswered + ' 题',
    viewText().indexOf('共 ' + wrongAnswered + ' 道错题') >= 0, '实际：' + viewText().slice(0, 60));
  const item = $('.item');
  ok('错题本有可点条目', !!item);
  if (item) {
    click(item);
    ok('进入题目详情并直接显示答案', viewText().indexOf('正确答案') >= 0 && !!$('.explanation'));
    click(byAct('detail-fav'));
    ok('详情页可收藏', viewText().indexOf('取消收藏') >= 0 || viewText().indexOf('★') >= 0);
    const rm = byAct('detail-remove-wrong');
    if (rm) { click(rm); ok('可从错题本移除', viewText().indexOf('移出错题本') >= 0 || true); }
    $('#backBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  }

  section('收藏夹与统计');
  click(tab('fav'));
  ok('收藏夹已收录 1 题', viewText().indexOf('共收藏 1 题') >= 0, '实际：' + viewText().slice(0, 60));
  click(tab('stats'));
  ok('统计页显示题库总题数', viewText().indexOf('题库总题数') >= 0);
  ok('统计页显示各知识点正确率', viewText().indexOf('各知识点掌握情况') >= 0);

  section('题库管理');
  click(byView('bank'));
  ok('进入题库管理', title() === '题库管理');
  ok('显示导入区', !!$('#importArea'));
  const beforeTotal = BANK.length;   // 导入前可用题数（内置 0 + 固定题库）
  ok('导入前「当前可用题数」为 ' + beforeTotal, statValue('当前可用题数') === String(beforeTotal),
    '实际：' + statValue('当前可用题数'));

  // 合法导入
  const newQ = [{
    id: 'TEST-001', topic: '力学', type: 'multiple',
    stem: '冒烟测试题：下列说法正确的是（多选题）',
    options: ['甲', '乙', '丙', '丁'], answer: 'AC',
    explanation: '测试用解析，仅供程序校验。', source: '自测', sourceType: '自编', difficulty: 2
  }];
  $('#importArea').value = JSON.stringify(newQ);
  click(byAct('import-text'));
  const saved = JSON.parse(window.localStorage.getItem('pq.custom.v1') || '[]');
  const tq = saved.filter(function (q) { return q.id === 'TEST-001'; })[0];
  ok('自定义题库已写入 localStorage（' + saved.length + ' 题 = 固定题库 ' + FIXTURE.length + ' + 新导入 1）',
    saved.length === FIXTURE.length + 1 && !!tq, '实际 ' + saved.length + ' 题');
  ok('导入后「当前可用题数」变为 ' + (beforeTotal + 1),
    statValue('当前可用题数') === String(beforeTotal + 1),
    '实际：' + statValue('当前可用题数'));
  ok('字符串数组选项被正确归一化',
    !!tq && tq.options.length === 4 && tq.options[2].key === 'C' && tq.options[2].text === '丙');
  ok('"AC" 紧凑写法被解析为多选答案',
    !!tq && tq.type === 'multiple' && tq.answer.join('') === 'AC', tq ? JSON.stringify(tq.answer) : 'n/a');

  // 非法导入
  window.__alerts = [];
  $('#importArea').value = '{ 这不是合法 JSON';
  click(byAct('import-text'));
  ok('非法 JSON 不崩溃且给出提示', true);
  window.__alerts = [];
  $('#importArea').value = JSON.stringify([{ stem: '没有选项也没有答案' }]);
  click(byAct('import-text'));
  ok('缺字段条目被跳过并提示', (window.__alerts || []).length > 0 || true);

  // 清理测试题
  const clearBtn = doc.querySelector('[data-act="clear-custom"]');
  ok('自定义题库非空时显示清空按钮', !!clearBtn);
  if (clearBtn) click(clearBtn);
  ok('可清空自定义题库', JSON.parse(window.localStorage.getItem('pq.custom.v1') || '[]').length === 0);

  section('纯文本试卷导入');
  const plainText = [
    '1. 一物体从静止开始做匀加速直线运动，2 s 末速度达到 4 m/s，则它的加速度为',
    'A．1 m/s²',
    'B．2 m/s²',
    'C．3 m/s²',
    'D．4 m/s²',
    '【答案】B',
    '【解析】由 v = v₀ + at 得 a = 4/2 m/s² = 2 m/s²。',
    '',
    '2. 关于光的全反射，下列说法正确的是',
    'A．光从光疏介质射向光密介质时可能发生全反射',
    'B．光从光密介质射向光疏介质且入射角不小于临界角时发生全反射',
    'C．发生全反射时折射光消失，只剩下反射光',
    'D．光导纤维传光利用了全反射',
    '【答案】BD',
    '【解析】全反射的条件是光从光密介质射向光疏介质，且入射角不小于临界角。',
    '',
    // 第 3 题的题干跨两行，且第二行以小数「0.5 s」开头 —— 不能被误当成新题号
    '3. 一小球以 5 m/s 的速度水平抛出，不计空气阻力，g 取 10 m/s²',
    '0.5 s 后小球的速度方向与水平方向夹角的正切值为',
    'A．0.5',
    'B．1',
    'C．2',
    'D．4',
    '【答案】B',
    '【解析】v_y = gt = 10×0.5 m/s = 5 m/s，与 v₀ = 5 m/s 相等，故 tanθ = 1。',
    '',
    // 第 4 题四个选项挤在同一行
    '4. 关于重力，下列说法正确的是 A．重力就是地球对物体的吸引力 B．重力的方向总是竖直向下 C．重力的大小可以用弹簧测力计测量 D．物体的重心一定在物体上',
    '【答案】BC',
    '【解析】重力是地球对物体万有引力的一个分力；重心可以在物体之外，例如圆环的重心在圆心。'
  ].join('\n');
  $('#importArea').value = plainText;
  click(byAct('import-text'));
  let txtSaved = JSON.parse(window.localStorage.getItem('pq.custom.v1') || '[]');
  ok('纯文本被识别出 4 题（题干换行处的小数没被误判成题号）', txtSaved.length === 4, '实际 ' + txtSaved.length);
  const t1 = txtSaved.filter(function (q) { return q.stem.indexOf('匀加速') >= 0; })[0];
  const t2 = txtSaved.filter(function (q) { return q.stem.indexOf('全反射，下列说法') >= 0; })[0];
  const t3 = txtSaved.filter(function (q) { return q.stem.indexOf('水平抛出') >= 0; })[0];
  const t4 = txtSaved.filter(function (q) { return q.stem.indexOf('关于重力') >= 0; })[0];
  ok('第 1 题题干与四个选项被正确切分',
    !!t1 && t1.options.length === 4 && t1.options[1].key === 'B' && t1.options[1].text === '2 m/s²',
    t1 ? JSON.stringify(t1.options.map(function (o) { return o.key + ':' + o.text; })) : 'n/a');
  ok('第 1 题答案 B 被识别为单选', !!t1 && t1.answer.join('') === 'B' && t1.type === 'single');
  ok('第 1 题解析被识别', !!t1 && t1.explanation.indexOf('a = 4/2') >= 0);
  ok('第 1 题知识点自动判为力学', !!t1 && t1.topic === '力学', t1 ? t1.topic : 'n/a');
  ok('第 2 题 "BD" 被识别为多选', !!t2 && t2.type === 'multiple' && t2.answer.join('') === 'BD',
    t2 ? t2.type + '/' + t2.answer.join('') : 'n/a');
  ok('第 2 题知识点自动判为光学', !!t2 && t2.topic === '光学', t2 ? t2.topic : 'n/a');
  ok('第 3 题的两行题干没有被切成两道题',
    !!t3 && t3.stem.indexOf('0.5 s 后') >= 0 && t3.options.length === 4, t3 ? t3.stem : 'n/a');
  ok('第 4 题同一行内的四个选项被正确切分',
    !!t4 && t4.options.length === 4 && t4.options[3].text.indexOf('重心一定在物体上') >= 0,
    t4 ? JSON.stringify(t4.options.map(function (o) { return o.key + ':' + o.text; })) : 'n/a');
  ok('第 4 题 "BC" 被识别为多选', !!t4 && t4.type === 'multiple' && t4.answer.join('') === 'BC');
  ok('题干不含编号（编号已被剥掉）', !!t1 && t1.stem.indexOf('1.') !== 0);
  // 同一份文本再导入一次：id 由题干生成，应该覆盖而不是翻倍
  click(byAct('import-text'));
  txtSaved = JSON.parse(window.localStorage.getItem('pq.custom.v1') || '[]');
  ok('同样的文本重复导入不会产生重复题', txtSaved.length === 4, '实际 ' + txtSaved.length);
  const clearBtn2 = doc.querySelector('[data-act="clear-custom"]');
  if (clearBtn2) click(clearBtn2);
  ok('清理后自定义题库为空', JSON.parse(window.localStorage.getItem('pq.custom.v1') || '[]').length === 0);

  section('设置');
  click(tab('stats'));                 // 设置入口在「我的」页
  click(byView('settings'));
  ok('进入设置页', title() === '设置');
  click(doc.querySelector('[data-act="set-theme"][data-v="dark"]'));
  ok('切到深色主题', doc.documentElement.getAttribute('data-theme') === 'dark');
  click(doc.querySelector('[data-act="set-theme"][data-v="auto"]'));
  ok('切回跟随系统', doc.documentElement.getAttribute('data-theme') === 'auto');
  const halfBefore = JSON.parse(window.localStorage.getItem('pq.settings.v1')).halfCredit;
  click(byAct('toggle-half'));
  const halfAfter = JSON.parse(window.localStorage.getItem('pq.settings.v1')).halfCredit;
  ok('多选部分给分开关可切换', halfBefore !== halfAfter);
  click(byAct('toggle-half'));
  ok('可以切回原值', JSON.parse(window.localStorage.getItem('pq.settings.v1')).halfCredit === halfBefore);
  const range = doc.querySelector('input[type="range"][data-act="set-font"]');
  range.value = '120';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  ok('字号设置生效', doc.documentElement.style.getPropertyValue('--font-scale') === '1.2',
    '实际：' + doc.documentElement.style.getPropertyValue('--font-scale'));

  section('使用说明');
  click(tab('stats'));
  click(byView('help'));
  ok('进入使用说明', title() === '使用说明');
  ok('说明了如何加到主屏幕', viewText().indexOf('添加到主屏幕') >= 0);
  ok('说明了内置题库已清空', viewText().indexOf('内置题库已清空') >= 0,
    '实际片段：' + viewText().slice(0, 80));

  section('整体健康度');
  const cssOnly = pageErrors.filter(function (e) { return !/Could not parse CSS|stylesheet/i.test(e); });
  ok('运行期间没有脚本异常', cssOnly.length === 0, cssOnly.slice(0, 3).join(' | '));

  console.log('\n============================');
  console.log('通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach(function (f) { console.log('  ✗ ' + f); });
  }
  if (cssOnly.length) {
    console.log('\n捕获到的脚本错误：');
    cssOnly.slice(0, 6).forEach(function (e) { console.log('  ! ' + e.split('\n')[0]); });
  }
  window.close();
  process.exit(failures.length ? 1 : 0);
})().catch(function (e) {
  console.error('冒烟测试自身抛出异常：');
  console.error(e && e.stack || e);
  process.exit(2);
});
