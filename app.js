/* ==========================================================================
   物理刷题 · 应用逻辑
   零依赖、无构建步骤。题库来源：data/questions.js（内置）+ localStorage（导入）
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 常量 */
  var TOPICS = ['力学', '电磁学', '热学', '光学', '近代物理'];
  var KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
  var LS = {
    progress: 'pq.progress.v1',
    fav: 'pq.fav.v1',
    settings: 'pq.settings.v1',
    custom: 'pq.custom.v1'
  };
  var TOPIC_ICON = { '力学': '⚙', '电磁学': '⚡', '热学': '🌡', '光学': '◈', '近代物理': '⚛' };

  var DEFAULT_SETTINGS = {
    theme: 'auto',
    fontScale: 1,
    shuffleOptions: true,
    halfCredit: true,      // 多选"选对但不全"给半分（高考评分规则）
    keepScreenOn: true
  };

  /* ------------------------------------------------------------------ 存储 */
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('本地存储写入失败：' + (e && e.message ? e.message : e)); return false; }
  }

  var settings = Object.assign({}, DEFAULT_SETTINGS, readJSON(LS.settings, {}));
  var progress = readJSON(LS.progress, {});
  var favorites = readJSON(LS.fav, []);          // array of id
  var customBank = readJSON(LS.custom, []);      // array of question

  function saveSettings() { writeJSON(LS.settings, settings); }
  function saveProgress() { writeJSON(LS.progress, progress); }
  function saveFav() { writeJSON(LS.fav, favorites); }
  function saveCustom() { writeJSON(LS.custom, customBank); }

  /* ------------------------------------------------------------------ 工具 */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

  // 由题干内容生成稳定的 id：同一道题反复导入不会变成两条，不同题不会互相覆盖
  function hashId(stem) {
    var h = 5381;
    var s = String(stem).replace(/\s+/g, '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'TX-' + h.toString(36).toUpperCase();
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    // 触发重排以保证动画
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ------------------------------------------------------------- 题库装配 */
  var builtinBank = [];

  function normalizeQuestion(raw, seq) {
    if (!raw || typeof raw !== 'object') return { error: '不是对象' };
    var q = {};
    q.stem = String(raw.stem || raw.question || raw.title || raw.content || '').trim();
    if (!q.stem) return { error: '缺少题干（stem）' };

    var opts = raw.options || raw.choices || raw.opts || [];
    if (!Array.isArray(opts)) return { error: 'options 不是数组' };
    q.options = opts.map(function (o, i) {
      if (o && typeof o === 'object') {
        return { key: String(o.key || o.label || KEYS[i] || ('选项' + (i + 1))).trim().toUpperCase(), text: String(o.text || o.value || o.content || '').trim() };
      }
      return { key: KEYS[i] || ('选项' + (i + 1)), text: String(o === null || o === undefined ? '' : o).trim() };
    }).filter(function (o) { return o.text !== ''; });
    if (q.options.length < 2) return { error: '有效选项少于 2 个' };

    // 答案归一化：支持 "B"、"BC"、"B,C"、["B","C"]、[1,2]（索引）
    var ansRaw = raw.answer !== undefined ? raw.answer : (raw.answers !== undefined ? raw.answers : raw.correct);
    var ans = [];
    if (Array.isArray(ansRaw)) ans = ansRaw.slice();
    else if (typeof ansRaw === 'number') ans = [ansRaw];
    else if (typeof ansRaw === 'string') {
      var s0 = ansRaw.trim().toUpperCase();
      if (/^[A-F]{2,}$/.test(s0)) ans = s0.split('');            // "BC" → ["B","C"]
      else if (/^\d{2,}$/.test(s0)) ans = s0.split('');          // "12" → ["1","2"]
      else ans = s0.replace(/[^A-F0-9,、\s]/g, ' ').split(/[,、\s]+/).filter(Boolean);
    }
    ans = ans.map(function (v) {
      if (typeof v === 'number') return q.options[v] ? q.options[v].key : null;
      var s = String(v).trim().toUpperCase();
      if (/^[A-F]$/.test(s)) return s;
      if (/^\d+$/.test(s)) { var i = parseInt(s, 10); return q.options[i] ? q.options[i].key : null; }
      return null;
    }).filter(Boolean);
    ans = uniq(ans).filter(function (k) { return q.options.some(function (o) { return o.key === k; }); });
    if (!ans.length) return { error: '缺少可识别的答案（answer）' };

    q.answer = ans;
    q.type = (raw.type === 'multiple' || raw.type === 'multi' || raw.multi === true || ans.length > 1) ? 'multiple' : 'single';
    if (q.type === 'single' && ans.length > 1) q.type = 'multiple';

    q.explanation = String(raw.explanation || raw.analysis || raw.solution || raw.parse || '（暂无解析）').trim();
    q.topic = String(raw.topic || raw.category || '未分类').trim();
    var tags = raw.tags || raw.knowledge || raw.points || [];
    if (typeof tags === 'string') tags = tags.split(/[,，、;；\s]+/).filter(Boolean);
    q.tags = Array.isArray(tags) ? tags.map(function (t) { return String(t).trim(); }).filter(Boolean).slice(0, 4) : [];
    q.source = String(raw.source || raw.from || '').trim();
    var st = String(raw.sourceType || raw.source_type || '').trim();
    q.sourceType = ['真题', '真题改编', '模拟题', '自编'].indexOf(st) >= 0 ? st : (st ? st : '未标注');
    var d = parseInt(raw.difficulty, 10);
    q.difficulty = (d >= 1 && d <= 5) ? d : 3;

    q.id = String(raw.id || '').trim();
    if (!q.id) q.id = hashId(q.stem);
    return { q: q };
  }

  function loadBank() {
    builtinBank = Array.isArray(window.PHYSICS_BANK) ? window.PHYSICS_BANK : [];
    var seen = {};
    var merged = [];
    builtinBank.concat([]).forEach(function (q) {
      if (q && q.id && !seen[q.id]) { seen[q.id] = 1; merged.push(q); }
    });
    // 导入题库覆盖同名 id，便于老师修正内置题
    var byId = {};
    merged.forEach(function (q) { byId[q.id] = q; });
    customBank.forEach(function (q) { byId[q.id] = q; });
    state.bank = Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function qById(id) {
    for (var i = 0; i < state.bank.length; i++) if (state.bank[i].id === id) return state.bank[i];
    return null;
  }

  function isFav(id) { return favorites.indexOf(id) >= 0; }
  function toggleFav(id) {
    var i = favorites.indexOf(id);
    if (i >= 0) { favorites.splice(i, 1); toast('已取消收藏'); }
    else { favorites.push(id); toast('已收藏'); }
    saveFav(); updateBadges();
    return i < 0;
  }

  function statOf(id) {    return progress[id] || { attempts: 0, full: 0, wrong: 0, scoreSum: 0, lastWrong: false, lastAt: 0 };
  }

  function recordAnswer(q, score) {
    var s = statOf(q.id);
    s.attempts += 1;
    s.scoreSum = (s.scoreSum || 0) + score;
    if (score >= 1) s.full += 1; else s.wrong += 1;
    s.lastWrong = score < 1;
    s.lastAt = Date.now();
    progress[q.id] = s;
    saveProgress();
  }

  function wrongList() {
    return state.bank.filter(function (q) { return statOf(q.id).lastWrong; });
  }
  function favList() {
    return state.bank.filter(function (q) { return isFav(q.id); });
  }

  /* --------------------------------------------------------------- 主题等 */
  function applySettings() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.style.setProperty('--font-scale', settings.fontScale);
  }

  /* ---------------------------------------------------------------- 状态 */
  var state = {
    bank: [],
    view: 'home',
    session: null,
    setup: { count: 10, topics: [], types: [], onlyNew: false, shuffleOptions: false, multipleOnly: false }
  };

  /* --------------------------------------------------------------- 视图层 */
  var viewEl, titleEl, backBtn, timerEl, tabbar;

  function setTitle(t) { titleEl.textContent = t; }
  function showBack(show) { backBtn.hidden = !show; }

  function setTab(tab) {
    Array.prototype.forEach.call(tabbar.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
    });
  }

  var VIEW_TAB = {
    home: 'home', topics: 'home', setup: 'home', practice: 'home', result: 'home',
    wrong: 'wrong', fav: 'fav', stats: 'stats', bank: 'stats', settings: 'stats', help: 'stats', detail: null
  };

  function go(view, opts) {
    opts = opts || {};
    state.view = view;
    var tab = VIEW_TAB[view];
    if (tab) setTab(tab);
    var back = opts.back !== undefined ? opts.back : (view !== 'home');
    showBack(back);
    viewEl.innerHTML = renderers[view] ? renderers[view](opts) : '<div class="empty">未知视图</div>';
    if (opts.title) setTitle(opts.title);
    else if (titles[view]) setTitle(titles[view]);
    window.scrollTo(0, 0);
    updateBadges();
    updateTimer();
    if (view !== 'practice') stopTimer();
  }

  var titles = {
    home: '物理刷题', topics: '按知识点练习', setup: '随机组卷', practice: '答题',
    result: '本轮成绩', wrong: '错题本', fav: '收藏夹', stats: '我的',
    bank: '题库管理', settings: '设置', help: '使用说明', detail: '题目详情'
  };

  function updateBadges() {
    var wb = document.getElementById('wrongBadge');
    var fb = document.getElementById('favBadge');
    var wn = wrongList().length, fn = favList().length;
    wb.textContent = wn > 99 ? '99+' : wn; wb.hidden = wn === 0;
    fb.textContent = fn > 99 ? '99+' : fn; fb.hidden = fn === 0;
  }

  /* ------------------------------------------------------------------ 计时 */
  function startTimer() {
    stopTimer();
    if (!state.session) return;
    state.session.timerId = setInterval(function () {
      if (!state.session) return;
      state.session.elapsed += 1;
      updateTimer();
    }, 1000);
  }
  function stopTimer() {
    if (state.session && state.session.timerId) {
      clearInterval(state.session.timerId);
      state.session.timerId = null;
    }
  }
  function updateTimer() {
    var on = state.session && state.view === 'practice';
    timerEl.hidden = !on;
    if (on) timerEl.textContent = fmtTime(state.session.elapsed);
  }

  /* ================================================================== 首页 */
  function renderHome() {
    var total = state.bank.length;
    var attempted = 0, fullSum = 0, attemptSum = 0;
    state.bank.forEach(function (q) {
      var s = progress[q.id];
      if (s && s.attempts) { attempted += 1; fullSum += s.full; attemptSum += s.attempts; }
    });
    var acc = pct(fullSum, attemptSum);
    var resume = state.session && !state.session.done;

    var html = '';
    html += '<div class="hero">'
      + '<h2>高中物理 · 选择题</h2>'
      + '<p>高考真题与真题改编 · 按知识点分类</p>'
      + '<div class="hero-stats">'
      + '<div class="hero-stat"><b>' + total + '</b><span>题库总题数</span></div>'
      + '<div class="hero-stat"><b>' + attempted + '</b><span>已练习</span></div>'
      + '<div class="hero-stat"><b>' + (attemptSum ? acc + '%' : '—') + '</b><span>正确率</span></div>'
      + '</div></div>';

    if (resume) {
      var done = state.session.records.length;
      html += '<button class="mode" data-act="resume" type="button">'
        + '<span class="mode-ico">▶</span>'
        + '<span class="mode-body"><b>继续上次练习</b><span>' + esc(state.session.title) + ' · 已完成 ' + done + '/' + state.session.queue.length + ' 题</span></span>'
        + '<span class="mode-go">›</span></button>';
    }

    if (!total) {
      html += '<div class="notice warn"><b>题库为空。</b>请在「我的 → 题库管理」中导入题目 JSON，或检查 <code>data/questions.js</code> 是否存在。</div>';
    }

    html += '<div class="sec-title">开始刷题</div>';
    html += modeBtn('setup', '⚄', '随机组卷', '自选知识点与题量，随机抽题');
    html += modeBtn('topics', '☰', '按知识点练习', '按力学 / 电磁学 / 热学 / 光学 / 近代物理顺序刷');
    html += modeBtn('act-wrong-start', '✗', '错题重做', wrongList().length ? ('错题本共 ' + wrongList().length + ' 题') : '还没有错题，先去练几道');
    html += modeBtn('act-fav-start', '★', '收藏重做', favList().length ? ('收藏夹共 ' + favList().length + ' 题') : '还没有收藏的题目');
    html += modeBtn('act-all-start', '∞', '全部题目随机', '打乱整个题库，' + total + ' 题');

    html += '<div class="sec-title">题库与设置</div>';
    html += modeBtn('bank', '⇪', '题库管理', '导入 / 导出题目，查看题库构成');
    html += modeBtn('settings', '⚙', '设置', '主题、字号、评分规则');
    html += modeBtn('help', '?', '使用说明', '怎么加到 iPhone 主屏幕、怎么加题');

    return html;
  }

  function modeBtn(act, ico, title, sub) {
    var attr = (act === 'setup' || act === 'topics' || act === 'bank' || act === 'settings' || act === 'help')
      ? 'data-view="' + act + '"' : 'data-act="' + act + '"';
    return '<button class="mode" ' + attr + ' type="button">'
      + '<span class="mode-ico">' + ico + '</span>'
      + '<span class="mode-body"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></span>'
      + '<span class="mode-go">›</span></button>';
  }

  /* ============================================================== 知识点列表 */
  function renderTopics() {
    var html = '<div class="notice">按知识点顺序练习，题目顺序固定、便于系统梳理。每类显示该知识点的历史正确率。</div>';
    var any = false;
    TOPICS.concat(otherTopics()).forEach(function (t) {
      var qs = state.bank.filter(function (q) { return q.topic === t; });
      if (!qs.length) return;
      any = true;
      var attempts = 0, full = 0;
      qs.forEach(function (q) { var s = progress[q.id]; if (s && s.attempts) { attempts += s.attempts; full += s.full; } });
      var acc = attempts ? pct(full, attempts) + '%' : '未练习';
      html += '<button class="mode" data-act="topic-start" data-topic="' + esc(t) + '" type="button">'
        + '<span class="mode-ico">' + (TOPIC_ICON[t] || '◆') + '</span>'
        + '<span class="mode-body"><b>' + esc(t) + '</b><span>' + qs.length + ' 题 · 正确率 ' + acc + '</span></span>'
        + '<span class="mode-go">›</span></button>';
    });
    if (!any) html += '<div class="empty"><div class="empty-ico">∅</div><b>题库里还没有题目</b><p>请先在「我的 → 题库管理」中导入题目。</p></div>';
    return html;
  }

  function otherTopics() {
    var known = {};
    state.bank.forEach(function (q) {
      if (TOPICS.indexOf(q.topic) < 0) known[q.topic] = 1;
    });
    return Object.keys(known);
  }

  /* ============================================================== 组卷设置 */
  function renderSetup() {
    var s = state.setup;
    var html = '';
    html += '<div class="card">';
    html += '<div class="field"><label>题目数量</label>'
      + '<div class="row"><input id="setCount" type="number" min="1" max="200" value="' + s.count + '" class="grow">'
      + '<span class="muted small" style="flex:none">题</span></div></div>';

    html += '<div class="field"><label>知识点（不选＝全部）</label><div class="row wrap">';
    TOPICS.concat(otherTopics()).forEach(function (t) {
      var n = state.bank.filter(function (q) { return q.topic === t; }).length;
      if (!n) return;
      var on = s.topics.indexOf(t) >= 0;
      html += '<button class="btn sm ' + (on ? 'primary' : 'ghost') + '" data-act="toggle-topic" data-topic="' + esc(t) + '" type="button">' + esc(t) + ' ' + n + '</button>';
    });
    html += '</div></div>';

    html += '<div class="field"><label>题型（不选＝全部）</label><div class="row wrap">';
    [['single', '单选'], ['multiple', '多选']].forEach(function (p) {
      var n = state.bank.filter(function (q) { return q.type === p[0]; }).length;
      var on = s.types.indexOf(p[0]) >= 0;
      html += '<button class="btn sm ' + (on ? 'primary' : 'ghost') + '" data-act="toggle-type" data-type="' + p[0] + '" type="button">' + p[1] + ' ' + n + '</button>';
    });
    html += '</div></div>';

    html += '<div class="switch"><span class="switch-label"><b>只抽没做过的题</b><span>已练过的题目跳过</span></span>'
      + '<button class="toggle ' + (s.onlyNew ? 'on' : '') + '" data-act="toggle-onlyNew" type="button" aria-label="只抽没做过的题"></button></div>';
    html += '<div class="switch"><span class="switch-label"><b>打乱选项顺序</b><span>防止记位置</span></span>'
      + '<button class="toggle ' + (s.shuffleOptions ? 'on' : '') + '" data-act="toggle-shuffle" type="button" aria-label="打乱选项顺序"></button></div>';
    html += '</div>';

    var pool = filterPool(s);
    html += '<div class="notice">当前条件下可抽题 <b>' + pool.length + '</b> 题。</div>';
    html += '<button class="btn primary block" data-act="start-random" type="button"' + (pool.length ? '' : ' disabled') + '>开始答题</button>';
    return html;
  }

  function filterPool(s) {
    return state.bank.filter(function (q) {
      if (s.topics.length && s.topics.indexOf(q.topic) < 0) return false;
      if (s.types.length && s.types.indexOf(q.type) < 0) return false;
      if (s.onlyNew && statOf(q.id).attempts > 0) return false;
      return true;
    });
  }

  /* ================================================================ 答题界面 */
  function startSession(list, opts) {
    if (!list || !list.length) { toast('没有可用的题目'); return; }
    var queue = list.slice();
    if (opts.shuffle) queue = shuffle(queue);
    state.session = {
      title: opts.title || '练习',
      queue: queue,
      idx: 0,
      picked: [],
      submitted: false,
      feedback: null,
      records: [],
      elapsed: 0,
      timerId: null,
      done: false,
      opts: opts
    };
    if (opts.shuffleOptions) {
      state.session.queue = queue.map(function (q) {
        var order = shuffle(q.options);
        return Object.assign({}, q, { options: order, _origOptions: q.options });
      });
    }
    go('practice', { title: opts.title || '答题', back: true });
    startTimer();
  }

  function curQ() {
    var s = state.session;
    return s ? s.queue[s.idx] : null;
  }

  function renderPractice() {
    var s = state.session;
    if (!s) return '<div class="empty"><b>没有正在进行的练习</b></div>';
    var q = curQ();
    if (!q) return '<div class="empty"><b>本轮已结束</b></div>';
    var total = s.queue.length;
    var html = '';

    html += '<div class="progressbar"><i style="width:' + pct(s.idx + (s.submitted ? 1 : 0), total) + '%"></i></div>';
    html += '<div class="qhead">'
      + '<span class="chip brand">' + (s.idx + 1) + ' / ' + total + '</span>'
      + '<span class="chip ' + (q.type === 'multiple' ? 'warn' : '') + '">' + (q.type === 'multiple' ? '多选题' : '单选题') + '</span>'
      + '<span class="chip">' + esc(q.topic) + '</span>'
      + '<span class="chip">难度 ' + q.difficulty + '</span>'
      + (q.source ? '<span class="chip">' + esc(q.source) + '</span>' : '')
      + '</div>';

    if (q.type === 'multiple' && !s.submitted) {
      html += '<div class="notice warn">多选题：正确选项有 ' + q.answer.length + ' 个。' +
        (settings.halfCredit ? '全对得满分，选对但不全得半分，有错选不得分。' : '必须全部选对才得分。') + '</div>';
    }

    html += '<div class="card"><p class="stem">' + esc(q.stem) + '</p>';
    html += '<div class="opts">';
    q.options.forEach(function (o) {
      var cls = 'opt', mark = '';
      var picked = s.picked.indexOf(o.key) >= 0;
      var isAns = q.answer.indexOf(o.key) >= 0;
      if (!s.submitted) {
        if (picked) cls += ' is-picked';
      } else {
        if (isAns) { cls += ' is-right'; mark = '<span class="opt-mark">✓</span>'; }
        else if (picked) { cls += ' is-wrong'; mark = '<span class="opt-mark">✗</span>'; }
        if (picked && !isAns) cls += '';
      }
      html += '<button class="' + cls + '" data-act="pick" data-key="' + esc(o.key) + '" type="button"' + (s.submitted ? ' disabled' : '') + '>'
        + '<span class="opt-key">' + esc(o.key) + '</span>'
        + '<span class="opt-text">' + esc(o.text) + '</span>'
        + mark + '</button>';
    });
    html += '</div></div>';

    if (s.submitted && s.feedback) {
      var f = s.feedback;
      var vcls = f.score >= 1 ? 'ok' : (f.score > 0 ? 'part' : 'bad');
      var vtxt = f.score >= 1 ? '回答正确' : (f.score > 0 ? '选对但不全（得半分）' : '回答错误');
      var vico = f.score >= 1 ? '✓' : (f.score > 0 ? '±' : '✗');
      html += '<div class="verdict ' + vcls + '"><span class="v-ico">' + vico + '</span>'
        + '<span class="grow">' + vtxt
        + '<span class="v-sub"> · 你的答案 ' + (s.picked.length ? esc(s.picked.join('')) : '未作答')
        + '，正确答案 ' + esc(q.answer.join('')) + '</span></span></div>';
      html += '<div class="card"><div class="answer-line">【解析】</div><div class="explanation">' + esc(q.explanation) + '</div>';
      if (q.tags && q.tags.length) {
        html += '<hr class="divider"><div class="row wrap">' + q.tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') + '</div>';
      }
      html += '</div>';
    }

    html += '<div class="btn-row" style="margin-bottom:9px">';
    html += '<button class="btn ghost sm" data-act="fav-cur" type="button">' + (isFav(q.id) ? '★ 已收藏' : '☆ 收藏本题') + '</button>';
    html += '<button class="btn ghost sm" data-act="quit" type="button">结束本轮</button>';
    html += '</div>';

    html += '<div class="btn-row">';
    if (!s.submitted) {
      html += '<button class="btn primary" data-act="submit" type="button"' + (s.picked.length ? '' : ' disabled') + '>提交答案</button>';
    } else {
      var last = s.idx === total - 1;
      html += '<button class="btn primary" data-act="' + (last ? 'finish' : 'next') + '" type="button">' + (last ? '查看本轮成绩' : '下一题') + '</button>';
    }
    html += '</div>';

    return html;
  }

  function submitAnswer() {
    var s = state.session, q = curQ();
    if (!s || !q || s.submitted || !s.picked.length) return;
    var ans = q.answer.slice(), picked = s.picked.slice();
    var score = 0;
    if (q.type === 'multiple') {
      var hasWrong = picked.some(function (k) { return ans.indexOf(k) < 0; });
      if (hasWrong) score = 0;
      else if (picked.length === ans.length) score = 1;
      else score = settings.halfCredit ? 0.5 : 0;
    } else {
      score = (picked.length === 1 && picked[0] === ans[0]) ? 1 : 0;
    }
    s.submitted = true;
    s.feedback = { score: score };
    s.records.push({ qid: q.id, picked: picked, score: score });
    recordAnswer(q, score);
    go('practice', { title: s.title });
  }

  function nextQuestion() {
    var s = state.session;
    if (!s) return;
    if (s.idx >= s.queue.length - 1) { finishSession(); return; }
    s.idx += 1; s.picked = []; s.submitted = false; s.feedback = null;
    go('practice', { title: s.title });
  }

  function finishSession() {
    var s = state.session;
    if (!s) { go('home'); return; }
    s.done = true;
    stopTimer();
    go('result', { title: '本轮成绩' });
  }

  /* ================================================================== 成绩单 */
  function renderResult() {
    var s = state.session;
    if (!s) return '<div class="empty"><b>没有成绩可显示</b></div>';
    var recs = s.records;
    var scoreSum = recs.reduce(function (a, r) { return a + r.score; }, 0);
    var fullN = recs.filter(function (r) { return r.score >= 1; }).length;
    var wrongN = recs.filter(function (r) { return r.score < 1; }).length;
    var avgSec = recs.length ? Math.round(s.elapsed / recs.length) : 0;

    var html = '';
    html += '<div class="hero"><h2>' + (recs.length ? (scoreSum / recs.length >= 0.8 ? '很不错！' : scoreSum / recs.length >= 0.6 ? '继续加油' : '需要再练') : '本轮未作答') + '</h2>'
      + '<p>' + esc(s.title) + '</p>'
      + '<div class="hero-stats">'
      + '<div class="hero-stat"><b>' + (recs.length ? (Math.round(scoreSum / recs.length * 100) / 100) : 0) + '</b><span>得分率</span></div>'
      + '<div class="hero-stat"><b>' + fullN + '</b><span>全对</span></div>'
      + '<div class="hero-stat"><b>' + wrongN + '</b><span>答错/不全</span></div>'
      + '<div class="hero-stat"><b>' + fmtTime(s.elapsed) + '</b><span>用时</span></div>'
      + '</div></div>';

    html += '<div class="stat-grid mb8">'
      + statCard(recs.length, '本轮题数')
      + statCard(Math.round(scoreSum * 2) / 2, '总得分')
      + statCard(avgSec + 's', '平均每题')
      + statCard(pct(fullN, recs.length) + '%', '全对率')
      + '</div>';

    var wrongs = recs.filter(function (r) { return r.score < 1; });
    if (wrongs.length) {
      html += '<div class="sec-title">错题回顾（已自动进入错题本）</div><div class="card flush">';
      wrongs.forEach(function (r) {
        var q = qById(r.qid);
        if (!q) return;
        html += '<button class="item" data-view="detail" data-id="' + esc(q.id) + '" data-from="result" type="button">'
          + '<span class="chip bad">' + (r.score > 0 ? '半分' : '错') + '</span>'
          + '<span class="item-body"><b class="ellipsis">' + esc(q.stem.slice(0, 42)) + '</b>'
          + '<span class="item-sub">你的答案 ' + esc(r.picked.join('') || '未作答') + ' · 正确 ' + esc(q.answer.join('')) + ' · ' + esc(q.topic) + '</span></span>'
          + '<span class="mode-go">›</span></button>';
      });
      html += '</div>';
    } else if (recs.length) {
      html += '<div class="notice">本轮全部答对，没有错题。</div>';
    }

    html += '<div class="btn-row mt12">'
      + '<button class="btn primary" data-act="retry-same" type="button">再做一遍</button>'
      + '<button class="btn" data-act="retry-wrong" type="button"' + (wrongs.length ? '' : ' disabled') + '>只练错题</button>'
      + '</div>';
    html += '<div class="btn-row mt12"><button class="btn ghost block" data-view="home" data-act="clear-session" type="button">返回首页</button></div>';
    return html;
  }

  function statCard(v, label) {
    return '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* ================================================================ 错题本/收藏 */
  function renderWrong() {
    var list = wrongList();
    if (!list.length) {
      return '<div class="empty"><div class="empty-ico">✓</div><b>错题本是空的</b><p>答错的题会自动收进这里；再次答对后会自动移出。</p></div>';
    }
    return '<div class="notice">共 <b>' + list.length + '</b> 道错题。再次答对即自动移出错题本。</div>'
      + '<div class="btn-row mb8"><button class="btn primary" data-act="act-wrong-start" type="button">开始重做全部错题</button></div>'
      + topicBars(list)
      + '<div class="card flush">' + list.map(function (q) { return qItemHTML(q, 'wrong'); }).join('') + '</div>';
  }

  function renderFav() {
    var list = favList();
    if (!list.length) {
      return '<div class="empty"><div class="empty-ico">☆</div><b>收藏夹是空的</b><p>答题时点击「收藏本题」，题目会出现在这里。</p></div>';
    }
    return '<div class="notice">共收藏 <b>' + list.length + '</b> 题。</div>'
      + '<div class="btn-row mb8"><button class="btn primary" data-act="act-fav-start" type="button">开始重做收藏题</button></div>'
      + '<div class="card flush">' + list.map(function (q) { return qItemHTML(q, 'fav'); }).join('') + '</div>';
  }

  function qItemHTML(q, from) {
    var s = statOf(q.id);
    var meta = [];
    if (s.attempts) meta.push('练 ' + s.attempts + ' 次 · 对 ' + s.full + ' 次');
    meta.push(q.topic);
    if (q.source) meta.push(q.source);
    return '<button class="item" data-view="detail" data-id="' + esc(q.id) + '" data-from="' + from + '" type="button">'
      + '<span class="chip ' + (q.type === 'multiple' ? 'warn' : '') + '">' + q.answer.join('') + '</span>'
      + '<span class="item-body"><b class="ellipsis">' + esc(q.stem.slice(0, 46)) + '</b>'
      + '<span class="item-sub ellipsis">' + esc(meta.join(' · ')) + '</span></span>'
      + '<span class="mode-go">›</span></button>';
  }

  function topicBars(list) {
    var byTopic = {};
    list.forEach(function (q) { byTopic[q.topic] = (byTopic[q.topic] || 0) + 1; });
    var keys = Object.keys(byTopic);
    if (keys.length < 2) return '';
    var max = Math.max.apply(null, keys.map(function (k) { return byTopic[k]; }));
    return '<div class="card"><div class="bars">' + keys.map(function (k) {
      return '<div class="bar-row"><div class="bar-top"><b>' + esc(k) + '</b><span class="dim">' + byTopic[k] + ' 题</span></div>'
        + '<div class="bar"><i style="width:' + pct(byTopic[k], max) + '%"></i></div></div>';
    }).join('') + '</div></div>';
  }

  /* ================================================================== 题目详情 */
  function renderDetail(opts) {
    var q = qById(opts.id);
    if (!q) return '<div class="empty"><b>题目不存在</b><p>可能已被题库更新移除。</p></div>';
    var s = statOf(q.id);
    var html = '';
    html += '<div class="qhead">'
      + '<span class="chip ' + (q.type === 'multiple' ? 'warn' : '') + '">' + (q.type === 'multiple' ? '多选题' : '单选题') + '</span>'
      + '<span class="chip brand">' + esc(q.topic) + '</span>'
      + '<span class="chip">难度 ' + q.difficulty + '</span>'
      + '<span class="chip">' + esc(q.sourceType) + '</span>'
      + '</div>';
    html += '<div class="card"><p class="stem">' + esc(q.stem) + '</p><div class="opts">';
    q.options.forEach(function (o) {
      var isAns = q.answer.indexOf(o.key) >= 0;
      html += '<div class="opt ' + (isAns ? 'is-right' : '') + '">'
        + '<span class="opt-key">' + esc(o.key) + '</span>'
        + '<span class="opt-text">' + esc(o.text) + '</span>'
        + (isAns ? '<span class="opt-mark">✓</span>' : '') + '</div>';
    });
    html += '</div>';
    html += '<hr class="divider"><div class="answer-line">正确答案：' + esc(q.answer.join('')) + '</div>';
    html += '<div class="explanation">' + esc(q.explanation) + '</div>';
    if (q.source) html += '<hr class="divider"><div class="tiny dim">来源：' + esc(q.source) + '</div>';
    html += '</div>';

    if (s.attempts) {
      html += '<div class="card tight small muted">历史记录：练习 ' + s.attempts + ' 次，全对 ' + s.full + ' 次，错误 ' + s.wrong + ' 次。最近一次' + (s.lastWrong ? '答错或不全。' : '答对。') + '</div>';
    }

    html += '<div class="btn-row"><button class="btn" data-act="detail-fav" data-id="' + esc(q.id) + '" type="button">' + (isFav(q.id) ? '★ 取消收藏' : '☆ 收藏') + '</button>';
    if (s.lastWrong) html += '<button class="btn danger" data-act="detail-remove-wrong" data-id="' + esc(q.id) + '" type="button">移出错题本</button>';
    html += '</div>';
    return html;
  }

  /* ==================================================================== 统计 */
  function renderStats() {
    var total = state.bank.length;
    var attempted = 0, attemptSum = 0, fullSum = 0, neverN = 0;
    state.bank.forEach(function (q) {
      var s = progress[q.id];
      if (s && s.attempts) { attempted += 1; attemptSum += s.attempts; fullSum += s.full; }
      else neverN += 1;
    });
    var html = '';
    html += '<div class="stat-grid">'
      + statCard(total, '题库总题数')
      + statCard(attempted, '练过的题')
      + statCard(neverN, '还没做过')
      + statCard(attemptSum ? pct(fullSum, attemptSum) + '%' : '—', '总体正确率')
      + '</div>';

    html += '<div class="sec-title">各知识点掌握情况</div>';
    html += '<div class="card"><div class="bars">';
    var any = false;
    TOPICS.concat(otherTopics()).forEach(function (t) {
      var qs = state.bank.filter(function (q) { return q.topic === t; });
      if (!qs.length) return;
      any = true;
      var att = 0, fu = 0, wrongN = 0;
      qs.forEach(function (q) {
        var s = progress[q.id];
        if (s && s.attempts) { att += s.attempts; fu += s.full; }
        if (statOf(q.id).lastWrong) wrongN += 1;
      });
      var acc = att ? pct(fu, att) : 0;
      html += '<div class="bar-row"><div class="bar-top"><b>' + esc(t) + '</b>'
        + '<span class="dim">' + (att ? acc + '% · 练 ' + att + ' 次 · 错题 ' + wrongN : qs.length + ' 题 · 未练习') + '</span></div>'
        + '<div class="bar"><i style="width:' + (att ? acc : 0) + '%;background:' + (att ? (acc >= 80 ? 'var(--ok)' : acc >= 60 ? 'var(--brand)' : 'var(--bad)') : 'var(--line)') + '"></i></div></div>';
    });
    if (!any) html += '<div class="dim small">题库为空。</div>';
    html += '</div></div>';

    html += '<div class="sec-title">管理</div>';
    html += modeBtn('bank', '⇪', '题库管理', '导入、导出、查看题库构成');
    html += modeBtn('settings', '⚙', '设置', '主题、字号、评分规则');
    html += modeBtn('help', '?', '使用说明', '安装到手机、自己加题的方法');

    var src = {};
    state.bank.forEach(function (q) { src[q.sourceType] = (src[q.sourceType] || 0) + 1; });
    html += '<div class="card tight small muted">题库构成：' + esc(Object.keys(src).map(function (k) { return k + ' ' + src[k] + ' 题'; }).join('　')) + '</div>';
    return html;
  }

  /* ================================================================ 题库管理 */
  function renderBank() {
    var builtinN = builtinBank.length, customN = customBank.length;
    var html = '';
    html += '<div class="stat-grid mb8">'
      + statCard(state.bank.length, '当前可用题数')
      + statCard(builtinN, '内置题库')
      + statCard(customN, '我导入的题')
      + statCard(TOPICS.filter(function (t) { return state.bank.some(function (q) { return q.topic === t; }); }).length, '覆盖知识点')
      + '</div>';

    html += '<div class="notice warn"><b>内置题库中「真题」为 0 题。</b>现有题目都是按高考真题的模型与考法编拟的模拟题，或依教材模型自编，未照录任何原卷。详见「使用说明 → 关于题目来源」。</div>';

    html += '<div class="card">';
    html += '<div class="sec-title mt0">导入题目</div>';
    html += '<div class="notice">下面可以直接粘贴 <b>JSON 数组</b>，也可以直接粘贴<b>从试卷或网页复制的纯文本</b>——会自动识别题干、A/B/C/D 选项、<code>【答案】</code> 与 <code>【解析】</code>，并按关键词猜测知识点。也可以选择 <code>.json</code> 文件。导入的题目保存在本机，不会上传到任何服务器。</div>';
    html += '<div class="field"><textarea id="importArea" class="import-area" placeholder=\'1. 一物体从静止开始做匀加速直线运动，2 s 末速度达到 4 m/s，则它的加速度为\nA．1 m/s²\nB．2 m/s²\nC．3 m/s²\nD．4 m/s²\n【答案】B\n【解析】由 v = v₀ + at 得 a = v/t = 4/2 m/s² = 2 m/s²。\n\n（也可以粘贴 JSON 数组；点下面的「下载空白录入模板」可拿到 JSON 格式示例）\'></textarea></div>';
    html += '<div class="btn-row"><button class="btn primary" data-act="import-text" type="button">导入粘贴内容</button>'
      + '<label class="btn" style="position:relative;overflow:hidden">选择文件<input id="importFile" type="file" accept=".json,application/json,text/plain" style="position:absolute;inset:0;opacity:0"></label></div>';
    html += '</div>';

    html += '<div class="card">';
    html += '<div class="sec-title mt0">导出</div>';
    html += '<div class="btn-row" style="flex-direction:column">';
    html += '<button class="btn" data-act="export-custom" type="button">导出我导入的题库（' + customN + ' 题）</button>';
    html += '<button class="btn" data-act="export-all" type="button">导出全部题库（' + state.bank.length + ' 题）</button>';
    html += '<button class="btn" data-act="export-progress" type="button">导出练习记录与错题本</button>';
    html += '<button class="btn" data-act="download-template" type="button">下载空白录入模板</button>';
    html += '</div></div>';

    html += '<div class="card">';
    html += '<div class="sec-title mt0">题库明细</div>';
    TOPICS.concat(otherTopics()).forEach(function (t) {
      var qs = state.bank.filter(function (q) { return q.topic === t; });
      if (!qs.length) return;
      var single = qs.filter(function (q) { return q.type === 'single'; }).length;
      html += '<div class="row between small" style="padding:7px 0;border-bottom:1px solid var(--line-2)">'
        + '<span>' + esc(t) + '</span><span class="dim">' + qs.length + ' 题（单选 ' + single + ' / 多选 ' + (qs.length - single) + '）</span></div>';
    });
    html += '</div>';

    if (customN) {
      html += '<div class="btn-row"><button class="btn danger block" data-act="clear-custom" type="button">清空我导入的题库（' + customN + ' 题）</button></div>';
    }
    return html;
  }

  function download(filename, text) {
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
      toast('已开始下载：' + filename);
    } catch (e) { toast('下载失败：' + e.message); }
  }

  /* ---------------------------------------------- 纯文本试卷 → 题目（容错解析） */
  // 关键词猜测知识点。顺序有意义：越靠前的越"独特"，力学放最后作为兜底。
  // 注意：光学/力学都用到的词（干涉、衍射、偏振）必须带"光"字限定，否则会把机械波误判成光学。
  var TOPIC_HINTS = [
    ['电磁学', /电场|电势|电容|库仑|磁场|安培|洛伦兹|电磁感应|楞次|法拉第|自感|变压器|交变电流|远距离输电|LC 振荡|示波管|带电粒子在匀强磁场/],
    ['近代物理', /光电效应|光子|康普顿|德布罗意|波粒二象|能级|玻尔|氢原子|衰变|半衰期|核反应|质能方程|裂变|聚变|放射性|相对论|α粒子散射|黑体辐射|逸出功/],
    ['光学', /折射|全反射|临界角|光的干涉|双缝|薄膜|增透膜|光的衍射|单缝|光的偏振|偏振光|棱镜|色散|凸透镜|平面镜|光导纤维|光纤|激光|电磁波谱|视深/],
    ['热学', /分子|布朗运动|内能|热力学|理想气体|气体实验|玻意耳|查理定律|盖-吕萨克|晶体|液晶|饱和汽|表面张力|毛细|物态变化|阿伏加德罗|热机|熵增/],
    ['力学', /速度|加速度|位移|匀速|匀变速|牛顿|摩擦力|受力|共点力|超重|失重|平抛|圆周运动|万有引力|卫星|开普勒|动能|机械能|功率|动量|碰撞|简谐|机械波|振动|传送带|板块|自由落体/]
  ];
  function guessTopic(text) {
    for (var i = 0; i < TOPIC_HINTS.length; i++) {
      if (TOPIC_HINTS[i][1].test(text)) return TOPIC_HINTS[i][0];
    }
    return '未分类';
  }

  // 把「1. 题干 A．… B．… 【答案】B 【解析】…」这类试卷文本切成题目对象
  function parsePlainText(text) {
    var t = String(text).replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ');
    // 题目分界：行首的编号 + 标点，且标点后不是数字
    // （最后这一条很关键：否则「0.5 s 后小球…」这种换行开头的小数会被误当成新题号，把一道题切成两半）
    var chunks = t.split(/\n\s*(?=(?:[（(]?\d{1,3}\s*[.、．)）])(?:\s|[^\d\s]))/);
    var out = [];
    chunks.forEach(function (chunk) {
      var body = chunk.replace(/^\s*[（(]?\d{1,3}\s*[.、．)）]\s*/, '').trim();
      if (body.length < 6) return;

      // 1) 先摘出答案
      var answer = '';
      var am = body.match(/(?:【答案】|答案\s*[:：])\s*([A-Fa-f][A-Fa-f\s,，、]*|对|错|正确|错误)/);
      if (am) {
        answer = am[1].replace(/[^A-Fa-f]/g, '').toUpperCase();
        body = body.replace(am[0], '\n');
      }
      // 2) 再摘出解析
      var explanation = '';
      var em = body.match(/(?:【解析】|【详解】|【分析】|解析\s*[:：]|详解\s*[:：])([\s\S]+)$/);
      if (em) {
        explanation = em[1].trim();
        body = body.slice(0, em.index);
      }
      // 3) 再切分选项。不要求选项前必须有空格，这样「…正确的是 A．甲 B．乙」也能识别；
      //    但排除「0.5 A.」这类字母前面紧挨数字或小数点的情况。
      var optRe = /([A-Da-d])\s*[.、．)）:：]\s*/g;
      var marks = [], m;
      while ((m = optRe.exec(body)) !== null) {
        var before = m.index > 0 ? body.charAt(m.index - 1) : '\n';
        if (/[A-Za-z0-9.]/.test(before)) continue;
        marks.push({ letter: m[1].toUpperCase(), start: m.index, end: m.index + m[0].length });
      }
      if (marks.length < 2) return;   // 不是选择题，跳过
      var stem = body.slice(0, marks[0].start).trim();
      if (!stem) return;
      var options = [], seen = {};
      for (var i = 0; i < marks.length; i++) {
        var mk = marks[i];
        if (seen[mk.letter]) break;     // 出现重复字母说明串到下一题了
        seen[mk.letter] = 1;
        var next = (i + 1 < marks.length) ? marks[i + 1].start : body.length;
        var txt = body.slice(mk.end, next).replace(/\s+/g, ' ').trim();
        if (!txt) break;
        options.push({ key: mk.letter, text: txt });
      }
      if (options.length < 2) return;

      out.push({
        stem: stem,
        options: options,
        answer: answer,
        explanation: explanation || '（导入时未提供解析，请自行补充。）',
        topic: guessTopic(stem + ' ' + options.map(function (o) { return o.text; }).join(' ')),
        source: '手动录入',
        sourceType: '未标注',
        difficulty: 3
      });
    });
    return out;
  }

  function importQuestions(text) {
    var list = null;
    var fromText = false;
    var data = null;
    try { data = JSON.parse(String(text).trim()); } catch (e) { data = null; }

    if (data) {
      list = Array.isArray(data) ? data : (data && Array.isArray(data.questions) ? data.questions : null);
      if (!list) { toast('JSON 格式不对：应为题目数组或 { questions: [...] }'); return; }
    } else {
      list = parsePlainText(text);
      fromText = true;
      if (!list.length) { toast('既不是合法 JSON，也没能从文本中识别出题目'); return; }
    }
    var ok = [], errors = [];
    list.forEach(function (raw, i) {
      var r = normalizeQuestion(raw, i + 1);
      if (r.error) errors.push('第 ' + (i + 1) + ' 题：' + r.error);
      else ok.push(r.q);
    });
    if (!ok.length) {
      toast('没有导入任何题目');
      alert('导入失败：\n' + errors.slice(0, 12).join('\n') + (errors.length > 12 ? '\n…共 ' + errors.length + ' 条错误' : ''));
      return;
    }
    // 合并（同 id 覆盖）
    var map = {};
    customBank.forEach(function (q) { map[q.id] = q; });
    var added = 0, replaced = 0;
    ok.forEach(function (q) {
      if (map[q.id]) replaced += 1; else added += 1;
      map[q.id] = q;
    });
    customBank = Object.keys(map).map(function (k) { return map[k]; });
    saveCustom();
    loadBank();
    var msg = '导入成功：新增 ' + added + ' 题' + (replaced ? '，更新同 ID ' + replaced + ' 题' : '');
    if (fromText) msg += '\n\n（按纯文本识别导入：知识点是按关键词自动猜的，请核对；题目 id 由题干内容生成，同一道题反复粘贴不会变成两条。）';
    toast('导入成功：新增 ' + added + ' 题' + (replaced ? '，更新 ' + replaced + ' 题' : ''));
    if (errors.length) {
      alert(msg + '\n\n以下 ' + errors.length + ' 条被跳过：\n' + errors.slice(0, 12).join('\n')
        + (errors.length > 12 ? '\n…' : '')
        + (fromText ? '\n\n纯文本导入要求每题都带「【答案】X」或「答案：X」，没有识别到答案的题会被跳过。' : ''));
    }
    go('bank', { title: '题库管理' });
  }

  function readFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () { importQuestions(String(fr.result || '')); };
    fr.onerror = function () { toast('文件读取失败'); };
    fr.readAsText(file, 'utf-8');
  }

  var TEMPLATE = [
    {
      id: 'MY-001',
      topic: '力学',
      tags: ['动能定理'],
      type: 'single',
      stem: '（在这里写题干。不支持 LaTeX，请用 Unicode 符号，如 v₀、m/s²、×10⁻³。）',
      options: [
        { key: 'A', text: '选项 A 文字' },
        { key: 'B', text: '选项 B 文字' },
        { key: 'C', text: '选项 C 文字' },
        { key: 'D', text: '选项 D 文字' }
      ],
      answer: ['B'],
      explanation: '（在这里写解析：正确思路 + 其余选项为什么错。）',
      source: '自编',
      sourceType: '自编',
      difficulty: 3
    },
    {
      id: 'MY-002',
      topic: '电磁学',
      type: 'multiple',
      stem: '多选题示例：options 也可以直接写成字符串数组，answer 写成 "BC" 或 ["B","C"]。',
      options: ['选项 A', '选项 B', '选项 C', '选项 D'],
      answer: 'BC',
      explanation: '多选题把 type 写成 multiple，answer 写所有正确项。',
      source: '自编',
      sourceType: '自编',
      difficulty: 4
    }
  ];

  /* ==================================================================== 设置 */
  function renderSettings() {
    var html = '';
    html += '<div class="card">';
    html += '<div class="field"><label>主题</label><div class="row wrap">';
    [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].forEach(function (p) {
      html += '<button class="btn sm ' + (settings.theme === p[0] ? 'primary' : 'ghost') + '" data-act="set-theme" data-v="' + p[0] + '" type="button">' + p[1] + '</button>';
    });
    html += '</div></div>';
    html += '<div class="field"><label>字号：' + Math.round(settings.fontScale * 100) + '%</label>'
      + '<input type="range" min="90" max="130" step="5" value="' + Math.round(settings.fontScale * 100) + '" data-act="set-font">'
      + '<div class="tiny dim">题干的字号会随这个设置变化，方便在手机上看得更清楚。</div></div>';
    html += '</div>';

    html += '<div class="card">';
    html += '<div class="switch"><span class="switch-label"><b>多选题部分给分</b><span>全对得满分，选对但不全得半分（高考评分规则）</span></span>'
      + '<button class="toggle ' + (settings.halfCredit ? 'on' : '') + '" data-act="toggle-half" type="button" aria-label="多选题部分给分"></button></div>';
    html += '<div class="switch"><span class="switch-label"><b>组卷时默认打乱选项</b><span>防止学生记选项位置</span></span>'
      + '<button class="toggle ' + (settings.shuffleOptions ? 'on' : '') + '" data-act="toggle-shuffle-default" type="button" aria-label="默认打乱选项"></button></div>';
    html += '</div>';

    html += '<div class="sec-title">数据</div>';
    html += '<div class="card"><div class="btn-row" style="flex-direction:column">'
      + '<button class="btn" data-act="export-progress" type="button">导出练习记录</button>'
      + '<button class="btn danger" data-act="reset-progress" type="button">清空练习记录与错题本</button>'
      + '<button class="btn danger" data-act="reset-fav" type="button">清空收藏夹</button>'
      + '<button class="btn danger" data-act="reset-all" type="button">恢复出厂设置（含自定义题库）</button>'
      + '</div></div>';

    html += '<div class="card tight tiny dim">数据保存在本机浏览器中（localStorage）。清理 Safari 网站数据会一起清掉，重要题库请用「导出」备份。当前版本 v1.0。</div>';
    return html;
  }

  /* ================================================================ 使用说明 */
  function renderHelp() {
    var url = location.href.replace(/index\.html.*$/, '');
    return ''
      + '<div class="card"><div class="sec-title mt0">加到 iPhone 主屏幕</div>'
      + '<div class="small">1. 用 <b>Safari</b> 打开这个网址：<br><code>' + esc(url) + '</code><br><br>'
      + '2. 点底部中间的「分享」按钮（方框加向上箭头）。<br>'
      + '3. 在菜单里选「<b>添加到主屏幕</b>」。<br>'
      + '4. 取名「物理刷题」，点「添加」。<br><br>'
      + '之后从桌面图标打开就是全屏、无浏览器地址栏，和原生 App 一样。第一次打开后会自动缓存，断网也能刷。</div></div>'

      + '<div class="card"><div class="sec-title mt0">出题与选题</div>'
      + '<div class="small">· <b>随机组卷</b>：自选知识点（力学／电磁学／热学／光学／近代物理）、题型和题量，随机抽题。<br>'
      + '· <b>按知识点练习</b>：按知识点顺序刷，适合系统梳理。<br>'
      + '· <b>错题重做</b>：答错或选不全的题自动进错题本，答对后自动移出。<br>'
      + '· <b>收藏</b>：讲评时想留的题点一下收藏，之后集中重做。<br>'
      + '· 多选题按高考规则评分：全对满分，选对但不全得半分，有错选得零分。</div></div>'

      + '<div class="card"><div class="sec-title mt0">自己加题</div>'
      + '<div class="small">进入「我的 → 题库管理」：<br>'
      + '· 点「下载空白录入模板」拿到格式示例；<br>'
      + '· 把题目写成 JSON 数组，粘贴进去点「导入粘贴内容」，或直接选 <code>.json</code> 文件；<br>'
      + '· 题型用 <code>"type": "single"</code> 或 <code>"multiple"</code>；<br>'
      + '· <code>answer</code> 写 <code>"B"</code>、<code>"BC"</code> 或 <code>["B","C"]</code> 都行；<br>'
      + '· <code>options</code> 写字符串数组或 <code>[{"key":"A","text":"…"}]</code> 都行；<br>'
      + '· <code>topic</code> 建议用五个标准知识点之一，这样会自动归入对应分类；<br>'
      + '· 公式<b>不要用 LaTeX</b>，直接用 Unicode 字符（v₀、Δ、μ、×10⁻¹⁹）。</div></div>'

      + '<div class="card"><div class="sec-title mt0">关于题目来源（重要）</div>'
      + '<div class="small">每道题都带 <code>sourceType</code> 字段，四种取值：<br>'
      + '· <b>真题</b>：能核对到年份、卷别、题号的原题；<br>'
      + '· <b>真题改编</b>：有明确真题出处、并做过数据或情境改动；<br>'
      + '· <b>模拟题</b>：按高考真题的模型与考法编拟，不是原题；<br>'
      + '· <b>自编</b>：依教材典型模型自行命题；<br>'
      + '· <b>未标注</b>：你自己粘贴导入、还没写来源的题。<br><br>'
      + '<b>本批内置题库中「真题」为 0 题。</b>现有题目都是按高考真题的模型与考法编拟（模拟题）或依教材模型自编（自编），<b>没有照录任何一份原卷</b>。整理时凡无法确认出处的，一律不标成「真题」，也不写具体年份卷别——宁可标低，不冒充原题。<br><br>'
      + '题目内容由 AI 生成与整理，不是从任何题库网站抓取的作品。因此<b>正式用于考试、印发或对外发布前，请自行核对题目与解析</b>，尤其是数值题。<br><br>'
      + '你若拿到能核实的历年原题，按模板导入并把 <code>sourceType</code> 写成 <code>"真题"</code> 即可，它会单独归类显示。</div></div>'

      + '<div class="card"><div class="sec-title mt0">常见问题</div>'
      + '<details class="acc"><summary>记录会不会自己消失？</summary><div class="acc-body">记录存在这台手机的浏览器里（localStorage）。iOS 的 Safari 对「长期不打开的网站」可能清理本地存储（约 7 天不用），<b>从主屏幕图标打开的 App 一般不受影响</b>，但保险起见，建议隔一段时间用「设置 → 导出练习记录」存一份到「文件」App；自己导入的题库也用「题库管理 → 导出」备份。</div></details>'
      + '<details class="acc"><summary>换手机 / 换浏览器后记录没了？</summary><div class="acc-body">记录存在浏览器本地。请在旧设备用「设置 → 导出练习记录」保存 JSON，再在新设备导入题库即可；错题信息会随记录一起走，但需要题库 ID 一致。</div></details>'
      + '<details class="acc"><summary>离线能用吗？</summary><div class="acc-body">通过 https 网址打开过一次后，Service Worker 会把页面和题库缓存下来，之后断网也能刷。注意必须用 Safari 打开过至少一次。</div></details>'
      + '<details class="acc"><summary>怎么更新题目？</summary><div class="acc-body">导入同 ID 的题目会直接覆盖旧题。想批量替换，就在 JSON 里用和内置题相同的 id（例如 LX-001）。</div></details>'
      + '</div>';
  }

  /* ================================================================== 渲染表 */
  var renderers = {
    home: renderHome,
    topics: renderTopics,
    setup: renderSetup,
    practice: renderPractice,
    result: renderResult,
    wrong: renderWrong,
    fav: renderFav,
    detail: renderDetail,
    stats: renderStats,
    bank: renderBank,
    settings: renderSettings,
    help: renderHelp
  };

  /* ================================================================== 事件 */
  function startWrongSession() {
    var list = wrongList();
    if (!list.length) { toast('错题本是空的'); return; }
    startSession(list, { title: '错题重做', shuffle: true, shuffleOptions: settings.shuffleOptions });
  }
  function startFavSession() {
    var list = favList();
    if (!list.length) { toast('收藏夹是空的'); return; }
    startSession(list, { title: '收藏重做', shuffle: true, shuffleOptions: settings.shuffleOptions });
  }
  function startAllSession() {
    if (!state.bank.length) { toast('题库为空'); return; }
    startSession(state.bank, { title: '全部题目随机', shuffle: true, shuffleOptions: settings.shuffleOptions });
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act],[data-view],[data-tab]') : null;
    if (!el) return;

    var tab = el.getAttribute('data-tab');
    if (tab) {
      if (tab === 'home') {
        go(state.session && !state.session.done ? 'practice' : 'home', { title: state.session && !state.session.done ? state.session.title : '物理刷题', back: !!(state.session && !state.session.done) });
      } else {
        go(tab, { back: false });
      }
      return;
    }

    var view = el.getAttribute('data-view');
    if (view) {
      if (view === 'home') {
        if (el.getAttribute('data-act') === 'clear-session') state.session = null;
        go('home', { back: false });
        return;
      }
      if (view === 'detail') {
        go('detail', { id: el.getAttribute('data-id'), from: el.getAttribute('data-from'), title: '题目详情', back: true });
        return;
      }
      go(view, { title: titles[view], back: view !== 'home' });
      return;
    }

    var act = el.getAttribute('data-act');
    var s = state.session;
    switch (act) {
      /* --- 首页 --- */
      case 'resume': go('practice', { title: s.title, back: true }); startTimer(); break;
      case 'act-wrong-start': startWrongSession(); break;
      case 'act-fav-start': startFavSession(); break;
      case 'act-all-start': startAllSession(); break;

      case 'topic-start': {
        var t = el.getAttribute('data-topic');
        var list = state.bank.filter(function (q) { return q.topic === t; });
        startSession(list, { title: t + ' 专项练习', shuffle: false, shuffleOptions: settings.shuffleOptions });
        break;
      }

      /* --- 组卷设置 --- */
      case 'toggle-topic': {
        var tp = el.getAttribute('data-topic');
        var i = state.setup.topics.indexOf(tp);
        if (i >= 0) state.setup.topics.splice(i, 1); else state.setup.topics.push(tp);
        go('setup', { title: '随机组卷', back: true });
        break;
      }
      case 'toggle-type': {
        var ty = el.getAttribute('data-type');
        var j = state.setup.types.indexOf(ty);
        if (j >= 0) state.setup.types.splice(j, 1); else state.setup.types.push(ty);
        go('setup', { title: '随机组卷', back: true });
        break;
      }
      case 'toggle-onlyNew': state.setup.onlyNew = !state.setup.onlyNew; go('setup', { title: '随机组卷', back: true }); break;
      case 'toggle-shuffle': state.setup.shuffleOptions = !state.setup.shuffleOptions; go('setup', { title: '随机组卷', back: true }); break;
      case 'start-random': {
        var cntEl = document.getElementById('setCount');
        if (cntEl) {
          var v = parseInt(cntEl.value, 10);
          if (v >= 1 && v <= 200) state.setup.count = v;
        }
        var pool = filterPool(state.setup);
        if (!pool.length) { toast('当前条件下没有题目'); break; }
        var n = Math.min(state.setup.count, pool.length);
        startSession(shuffle(pool).slice(0, n), {
          title: '随机组卷 · ' + n + ' 题',
          shuffle: false,
          shuffleOptions: state.setup.shuffleOptions
        });
        break;
      }

      /* --- 答题 --- */
      case 'pick': {
        if (!s || s.submitted) break;
        var k = el.getAttribute('data-key');
        var q = curQ();
        if (q.type === 'single') s.picked = [k];
        else {
          var idx = s.picked.indexOf(k);
          if (idx >= 0) s.picked.splice(idx, 1); else s.picked.push(k);
          s.picked.sort();
        }
        go('practice', { title: s.title, back: true });
        break;
      }
      case 'submit': submitAnswer(); break;
      case 'next': nextQuestion(); break;
      case 'finish': finishSession(); break;
      case 'quit': {
        if (!s) break;
        if (s.records.length) finishSession();
        else { state.session = null; go('home', { back: false }); }
        break;
      }
      case 'fav-cur': {
        var cq = curQ();
        if (cq) { toggleFav(cq.id); go('practice', { title: s.title, back: true }); }
        break;
      }
      case 'retry-same': {
        var old = s.queue.slice();
        startSession(old, { title: s.title, shuffle: false, shuffleOptions: settings.shuffleOptions });
        break;
      }
      case 'retry-wrong': {
        var wq = s.records.filter(function (r) { return r.score < 1; }).map(function (r) { return qById(r.qid); }).filter(Boolean);
        startSession(wq, { title: '本轮错题', shuffle: false, shuffleOptions: settings.shuffleOptions });
        break;
      }

      /* --- 详情 --- */
      case 'detail-fav': {
        toggleFav(el.getAttribute('data-id'));
        go('detail', { id: el.getAttribute('data-id'), from: 'detail', title: '题目详情', back: true });
        break;
      }
      case 'detail-remove-wrong': {
        var rid = el.getAttribute('data-id');
        var st = statOf(rid);
        st.lastWrong = false;
        progress[rid] = st;
        saveProgress();
        toast('已移出错题本');
        go('detail', { id: rid, title: '题目详情', back: true });
        break;
      }

      /* --- 题库管理 --- */
      case 'import-text': {
        var area = document.getElementById('importArea');
        if (!area || !area.value.trim()) { toast('请先粘贴题目 JSON'); break; }
        importQuestions(area.value);
        break;
      }
      case 'export-custom': download('物理题库-我导入的.json', JSON.stringify(customBank, null, 2)); break;
      case 'export-all': download('物理题库-全部.json', JSON.stringify(state.bank, null, 2)); break;
      case 'export-progress': {
        download('物理刷题-练习记录.json', JSON.stringify({
          exportedAt: new Date().toISOString(),
          settings: settings,
          progress: progress,
          favorites: favorites
        }, null, 2));
        break;
      }
      case 'download-template': download('物理题库-录入模板.json', JSON.stringify(TEMPLATE, null, 2)); break;
      case 'clear-custom': {
        if (!confirm('确定清空你导入的 ' + customBank.length + ' 道题？内置题库不受影响。建议先导出备份。')) break;
        customBank = []; saveCustom(); loadBank();
        toast('已清空自定义题库');
        go('bank', { title: '题库管理', back: true });
        break;
      }

      /* --- 设置 --- */
      case 'set-theme': settings.theme = el.getAttribute('data-v'); saveSettings(); applySettings(); go('settings', { title: '设置', back: true }); break;
      case 'toggle-half': settings.halfCredit = !settings.halfCredit; saveSettings(); go('settings', { title: '设置', back: true }); break;
      case 'toggle-shuffle-default': settings.shuffleOptions = !settings.shuffleOptions; saveSettings(); go('settings', { title: '设置', back: true }); break;
      case 'reset-progress': {
        if (!confirm('清空全部练习记录和错题本？此操作不可撤销。')) break;
        progress = {}; saveProgress(); updateBadges(); toast('练习记录已清空');
        go('settings', { title: '设置', back: true });
        break;
      }
      case 'reset-fav': {
        if (!confirm('清空收藏夹？')) break;
        favorites = []; saveFav(); updateBadges(); toast('收藏夹已清空');
        go('settings', { title: '设置', back: true });
        break;
      }
      case 'reset-all': {
        if (!confirm('恢复出厂设置：将清空练习记录、收藏夹和你导入的题库。确定吗？')) break;
        progress = {}; favorites = []; customBank = [];
        settings = Object.assign({}, DEFAULT_SETTINGS);
        saveProgress(); saveFav(); saveCustom(); saveSettings();
        applySettings(); loadBank(); updateBadges();
        toast('已恢复出厂设置');
        go('home', { back: false });
        break;
      }
    }
  }

  function onChange(e) {
    var el = e.target;
    if (el.id === 'importFile' && el.files && el.files[0]) readFile(el.files[0]);
  }

  function onInput(e) {
    var el = e.target;
    var act = el.getAttribute && el.getAttribute('data-act');
    if (act === 'set-font') {
      settings.fontScale = parseInt(el.value, 10) / 100;
      document.documentElement.style.setProperty('--font-scale', settings.fontScale);
      saveSettings();
      var lab = el.previousElementSibling;
      if (lab) lab.textContent = '字号：' + el.value + '%';
    }
    if (el.id === 'setCount') {
      var v = parseInt(el.value, 10);
      if (v >= 1 && v <= 200) state.setup.count = v;
    }
  }

  /* ------------------------------------------------- 防止答到一半误退出 */
  window.addEventListener('beforeunload', function (e) {
    if (state.session && !state.session.done && state.session.records.length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ================================================================== 启动 */
  function init() {
    viewEl = document.getElementById('view');
    titleEl = document.getElementById('viewTitle');
    backBtn = document.getElementById('backBtn');
    timerEl = document.getElementById('timer');
    tabbar = document.getElementById('tabbar');

    applySettings();
    loadBank();

    viewEl.addEventListener('click', onClick);
    viewEl.addEventListener('change', onChange);
    viewEl.addEventListener('input', onInput);
    tabbar.addEventListener('click', onClick);
    backBtn.addEventListener('click', function () {
      if (state.view === 'practice') { go('home', { back: false }); return; }
      if (state.view === 'detail' || state.view === 'setup' || state.view === 'topics' || state.view === 'bank' || state.view === 'settings' || state.view === 'help') { go('home', { back: false }); return; }
      go('home', { back: false });
    });
    document.getElementById('themeBtn').addEventListener('click', function () {
      var order = ['auto', 'light', 'dark'];
      settings.theme = order[(order.indexOf(settings.theme) + 1) % 3];
      saveSettings(); applySettings();
      toast(settings.theme === 'auto' ? '主题：跟随系统' : settings.theme === 'light' ? '主题：浅色' : '主题：深色');
    });

    // 键盘快捷键（电脑上调试方便）
    document.addEventListener('keydown', function (e) {
      if (state.view !== 'practice') return;
      var s = state.session;
      if (!s) return;
      var q = curQ();
      if (e.key >= '1' && e.key <= '4') {
        var i = parseInt(e.key, 10) - 1;
        if (q.options[i]) { s.picked = [q.options[i].key]; go('practice', { title: s.title, back: true }); }
      } else if (e.key === 'Enter') {
        if (s.submitted) nextQuestion(); else submitAnswer();
      }
    });

    go('home', { back: false });

    // Service Worker：离线可用
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略：本地预览时可能不可用 */ });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
