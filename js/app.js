window.AC = window.AC || {};

/* ============================================================
   主控：导入 -> 分析 -> 渲染 的调度
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;
  const $ = U.$;
  const $$ = U.$$;

  const store = new AC.Store().load();

  const filters = {
    dimension: 'comp',
    minPair: 2,
    minAppear: 3,
    minLevel: 40,
    onlyFull: true,
    excludeMirror: true,
    excludeDraw: false,
    strongOnly: false,
    topN: 30,
    showLabels: true,
    showParticles: true,
    /* 培养度控制：默认开启红度对等，避免满红打白板污染克制结论 */
    onlyRedParity: true,
    redParityGap: 1,
    minRedAvg: 0,
    onlyPinParity: false,
    pinParityGap: 1,
    redTier: 'all',
    pinTier: 'all',
    graphMode: '2d'
  };

  const state = { view: 'graph', result: null, selection: null };

  let graph = null, matrix = null, rank = null, table = null, allianceView = null, heroesView = null;

  /* ================= 初始化 ================= */

  function init() {
    checkBuild();

    table = new AC.Table($('#dataTable'), $('#tablePager'));

    rank = new AC.Rank($('#rankWrap'), {
      onSelect: function (sel) { selectNode(sel.id, true); }
    });

    allianceView = new AC.AllianceView($('#allyList'), $('#allyDetail'), {
      // 在同盟分析里点某个阵容，直接跳到网络图并聚焦它
      onPickComp: function (key) {
        if (!state.result || !state.result.nodeMap.has(key)) {
          U.toast('该阵容在当前过滤条件下未进入图谱，试试调低「最少出场次数」。', '', 4200);
          return;
        }
        switchView('graph');
        selectNode(key);
      }
    });

    heroesView = new AC.HeroesView($('#heroList'), $('#heroDetail'), {
      onPickComp: function (key) {
        if (!state.result || !state.result.nodeMap.has(key)) return;
        switchView('graph');
        selectNode(key);
      }
    });

    matrix = new AC.Matrix($('#matrixCanvas'), {
      onHover: showMatrixTip,
      onSelect: function (sel) {
        const p = sel.pair;
        if (p) showPair(p.lo, p.hi);
        state.selection = { type: 'edge', id: p ? p.key : null };
        graph.setSelection(null);
        matrix.setSelection({ type: 'pair', k1: p.lo, k2: p.hi });
      }
    });

    graph = new AC.Graph($('#graphCanvas'), {
      onHover: showGraphTip,
      onSelect: function (sel) {
        if (!sel) { clearSelection(); return; }
        if (sel.type === 'node') selectNode(sel.id, false);
        else if (sel.type === 'edge') {
          const e = graph.edges.find(function (x) { return x.id === sel.id; });
          if (e) {
            showPair(e.data.pair.lo, e.data.pair.hi);
            state.selection = sel;
            matrix.setSelection({ type: 'pair', k1: e.data.pair.lo, k2: e.data.pair.hi });
          }
        }
      },
      onLayoutChange: function () { updateFoot(); }
    });

    graph.showLabels = filters.showLabels;
    graph.showParticles = filters.showParticles;

    // 2D / 3D 切换：3D 里 z 轴 = 净压制力（强的浮在上层）
    $$('#graphModeSeg .seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#graphModeSeg .seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        graph.setMode(mode);
        filters.graphMode = mode;
        const hint = $('#graphModeHint');
        if (hint) {
          hint.textContent = mode === '3d'
            ? '拖空白处旋转 · 滚轮缩放 · 高度 = 净压制力'
            : '2D 更适合看清克制关系';
        }
      });
    });

    bindUI();
    renderBatches();
    recompute(true);

    // 演示模式：index.html?demo=1[&view=matrix] 自动载入内置示例表
    const params = new URLSearchParams(location.search);
    if (params.get('demo') === '1' && AC.sampleCsv) {
      ingest(AC.sampleCsv, '示例战报表（内置）', true);
    }
    if (params.get('view')) switchView(params.get('view'));
    if (params.get('topn')) {
      filters.topN = Number(params.get('topn')) || filters.topN;
      syncControls();
      recompute();
    }

    if (!store.battles.length) {
      $('#graphEmpty').style.display = 'flex';
      U.toast('还没有数据。拖入战报 CSV，或点击「载入示例表」快速体验动画效果。', '', 5200);
    }
  }

  /* ================= UI 绑定 ================= */

  function bindUI() {
    // 文件选择
    $('#btnImport').addEventListener('click', function () { $('#fileInput').click(); });
    $('#dropzone').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', function (ev) {
      if (ev.target.files && ev.target.files.length) importFiles(ev.target.files);
      ev.target.value = '';
    });

    // 全局拖拽
    let dragDepth = 0;
    window.addEventListener('dragenter', function (ev) {
      if (!hasFiles(ev)) return;
      dragDepth++;
      $('#globalDrop').classList.add('show');
    });
    window.addEventListener('dragover', function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
    window.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $('#globalDrop').classList.remove('show');
    });
    window.addEventListener('drop', function (ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      dragDepth = 0;
      $('#globalDrop').classList.remove('show');
      const files = Array.prototype.filter.call(ev.dataTransfer.files, function (f) { return !/\.json$/i.test(f.name); });
      const jsons = Array.prototype.filter.call(ev.dataTransfer.files, function (f) { return /\.json$/i.test(f.name); });
      if (files.length) importFiles(files);
      if (jsons.length) importJsonFiles(jsons);
    });

    // 维度切换
    $$('#dimSeg .seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#dimSeg .seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        filters.dimension = btn.dataset.dim;
        $('#dimHint').textContent = filters.dimension === 'comp'
          ? '比较整套武将组合之间的相互胜率。'
          : '比较鱼鳞/箕形/偃月等阵型之间的相互胜率。';
        recompute();
      });
    });

    // 滑块
    bindRange('#minPair', '#minPairVal', 'minPair', function (v) { return v; });
    bindRange('#minAppear', '#minAppearVal', 'minAppear', function (v) { return v; });
    bindRange('#minLevel', '#minLevelVal', 'minLevel', function (v) { return v; });
    bindRange('#topN', '#topNVal', 'topN', function (v) { return v; }, true);

    bindCheck('#onlyFull', 'onlyFull');
    bindCheck('#excludeMirror', 'excludeMirror');
    bindCheck('#excludeDraw', 'excludeDraw');
    bindCheck('#onlyRedParity', 'onlyRedParity');
    bindCheck('#onlyPinParity', 'onlyPinParity');
    bindRange('#redGap', '#redGapVal', 'redParityGap', function (v) { return v; });
    bindRange('#minRedAvg', '#minRedAvgVal', 'minRedAvg', function (v) { return v; });

    // 培养度分层：切换后整张克制网络都按该档位重算
    bindTier('#redTierSeg', 'redTier');
    bindTier('#pinTierSeg', 'pinTier');
    bindCheck('#onlyStrong', 'strongOnly', function (v) { filters.strongOnly = v; });
    bindCheck('#showLabels', 'showLabels', function (v) { graph.showLabels = v; });
    bindCheck('#showParticles', 'showParticles', function (v) { graph.showParticles = v; });

    $('#btnResetFilter').addEventListener('click', function () {
      Object.assign(filters, {
        dimension: 'comp', minPair: 2, minAppear: 3, minLevel: 40,
        onlyFull: true, excludeMirror: true, excludeDraw: false, strongOnly: false, topN: 30,
        onlyRedParity: true, redParityGap: 1, minRedAvg: 0, onlyPinParity: false,
        redTier: 'all', pinTier: 'all'
      });
      syncControls();
      recompute();
    });

    $('#btnRelayout').addEventListener('click', function () { graph.relayout(); });

    $('#btnExportPng').addEventListener('click', exportPng);
    $('#btnExport').addEventListener('click', exportArchive);
    $('#btnImportJson').addEventListener('click', function () { $('#jsonInput').click(); });
    $('#jsonInput').addEventListener('change', function (ev) {
      if (ev.target.files && ev.target.files.length) importJsonFiles(ev.target.files);
      ev.target.value = '';
    });

    $('#btnClearAll').addEventListener('click', function () {
      if (!store.battles.length) { U.toast('当前没有数据。'); return; }
      if (!window.confirm('确定清空全部累计数据？此操作不可撤销。')) return;
      store.clear();
      renderBatches();
      clearSelection();
      recompute(true);
      U.toast('已清空全部数据。');
    });

    $('#btnLoadSample').addEventListener('click', function () {
      if (!AC.sampleCsv) { U.toast('未找到示例数据文件。', 'err'); return; }
      ingest(AC.sampleCsv, '示例战报表（内置）');
    });

    // 生成内置数据
    $('#btnBuildSample').addEventListener('click', function () { openGenDrawer(); });
    $('#genClose').addEventListener('click', closeGenDrawer);
    $('#genMask').addEventListener('click', closeGenDrawer);
    $('#genSource').addEventListener('change', function (ev) {
      genState.source = ev.target.value;
      renderGenPreview();
    });
    ['#genAnon', '#genAnonId', '#genAnonPlace'].forEach(function (sel) {
      $(sel).addEventListener('change', renderGenPreview);
    });
    $('#genDownloadJs').addEventListener('click', downloadGenJs);
    $('#genDownloadCsv').addEventListener('click', downloadGenCsv);

    // 视图切换
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.view); });
    });

    window.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (genState.open) { closeGenDrawer(); return; }
      clearSelection();
    });
  }

  function hasFiles(ev) {
    return ev.dataTransfer && ev.dataTransfer.types && Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') >= 0;
  }

  function bindRange(sel, labelSel, key, fmt, relayout) {
    const input = $(sel);
    input.value = filters[key];
    $(labelSel).textContent = fmt(filters[key]);
    input.addEventListener('input', function () {
      filters[key] = Number(input.value);
      $(labelSel).textContent = fmt(filters[key]);
      if (relayout) {
        clearTimeout(input._t);
        input._t = setTimeout(function () { recompute(); }, 160);
      } else {
        recomputeDebounced();
      }
    });
  }

  /** 分段控件：培养度档位（全部 / 低 / 中 / 高） */
  function bindTier(segSel, key) {
    $$(segSel + ' .seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$(segSel + ' .seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        filters[key] = btn.dataset.tier;
        recompute();
      });
    });
  }

  function bindCheck(sel, key, after) {    const box = $(sel);
    box.checked = filters[key];
    box.addEventListener('change', function () {
      filters[key] = box.checked;
      if (after) after(box.checked);
      recompute();
    });
  }

  function syncControls() {
    $('#minPair').value = filters.minPair; $('#minPairVal').textContent = filters.minPair;
    $('#minAppear').value = filters.minAppear; $('#minAppearVal').textContent = filters.minAppear;
    $('#minLevel').value = filters.minLevel; $('#minLevelVal').textContent = filters.minLevel;
    $('#topN').value = filters.topN; $('#topNVal').textContent = filters.topN;
    $('#onlyFull').checked = filters.onlyFull;
    $('#excludeMirror').checked = filters.excludeMirror;
    $('#excludeDraw').checked = filters.excludeDraw;
    $('#onlyStrong').checked = filters.strongOnly;
    $('#onlyRedParity').checked = filters.onlyRedParity;
    $('#onlyPinParity').checked = filters.onlyPinParity;
    $('#redGap').value = filters.redParityGap; $('#redGapVal').textContent = filters.redParityGap;
    $('#minRedAvg').value = filters.minRedAvg; $('#minRedAvgVal').textContent = filters.minRedAvg;
    $$('#redTierSeg .seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tier === filters.redTier); });
    $$('#pinTierSeg .seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tier === filters.pinTier); });
    $$('#dimSeg .seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.dim === filters.dimension); });
  }

  const recomputeDebounced = U.debounce(function () { recompute(); }, 200);

  /* ================= 数据导入 ================= */

  function decodeBuffer(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      try {
        return new TextDecoder('gb18030').decode(buf);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(buf);
      }
    }
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      fr.readAsArrayBuffer(file);
    });
  }

  async function importFiles(files) {
    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const buf = await readFile(f);
        const text = decodeBuffer(buf);
        const res = ingest(text, f.name);
        if (res) ok++; else fail++;
      } catch (e) {
        fail++;
        U.toast('导入 <b>' + f.name + '</b> 失败：' + e.message, 'err');
      }
    }
    if (ok) U.toast('完成：成功 ' + ok + ' 份' + (fail ? '，失败 ' + fail + ' 份' : ''), 'ok');
  }

  /** 解析一段 CSV 文本并叠加进仓库（同时支持宽表与武将级明细表） */
  function ingest(text, name, silent) {
    // ---- 路径一：武将级明细表（一场战斗拆成多行）----
    if (AC.detail && AC.detail.sniff(text)) {
      const d = AC.detail.parse(text);
      if (!d || !d.battles.length) {
        if (!silent) U.toast('明细表里没有解析出完整对局（需要同时包含攻方与守方）。', 'err', 4600);
        return null;
      }
      const res = store.add(d.battles, {
        name: name, rowTotal: d.rows.length, invalid: d.rows.length - d.battles.length * 2,
        detail: true, summary: d.summary
      });
      renderBatches();
      recompute(true);
      if (silent) return res;
      if (!res.added) {
        U.toast('<b>' + name + '</b>：' + res.dup + ' 场全部为重复记录，未新增。');
        return res;
      }
      const s = d.summary;
      U.toast('<b>' + name + '</b><br>明细表：新增 ' + res.added + ' 场，含 ' + s.heroRows +
        ' 条武将记录 · ' + s.heroes + ' 名武将 · ' + s.skills + ' 种技能', 'ok', 5200);
      return res;
    }

    // ---- 路径二：传统宽表（一场战斗一行）----
    const parsed = AC.csv.parseTable(text);
    if (!parsed.rows.length) {
      if (!silent) U.toast('未从 <b>' + name + '</b> 中解析出数据行。', 'err');
      return null;
    }

    const idx = parsed.mapping ? parsed.mapping.index : {};
    const missing = [];
    if (idx.atkComp === undefined && idx.atkFormation === undefined) missing.push('攻方阵容/阵型');
    if (idx.defComp === undefined && idx.defFormation === undefined) missing.push('守方阵容/阵型');

    const battles = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      const b = AC.model.toBattle(parsed.rows[i]);
      if (b) battles.push(b);
    }
    const invalid = parsed.rows.length - battles.length;

    if (!battles.length) {
      if (!silent) U.toast('文件中没有可用的战斗记录（缺少阵容或阵型列？）', 'err', 4600);
      return null;
    }

    const res = store.add(battles, { name: name, rowTotal: parsed.rows.length, invalid: invalid });
    renderBatches();
    recompute(true);
    if (silent) return res;

    if (!res.added) {
      if (!silent) U.toast('<b>' + name + '</b>：' + res.dup + ' 场全部为重复记录，未新增（已在累计数据中）。');
      return res;
    }

    let msg = '<b>' + name + '</b><br>新增 ' + res.added + ' 场，跳过重复 ' + res.dup + ' 场';
    if (invalid) msg += '，跳过无效行 ' + invalid;
    if (silent) return res;
    U.toast(msg, 'ok', 4200);
    if (missing.length) {
      U.toast('表头中未识别到：' + missing.join('、') + '。若数据异常请检查列名。', 'err', 5200);
    }
    return res;
  }

  async function importJsonFiles(files) {
    for (let i = 0; i < files.length; i++) {
      try {
        const text = await files[i].text();
        const res = store.importJSON(text);
        renderBatches();
        recompute(true);
        U.toast('<b>' + files[i].name + '</b><br>恢复 ' + res.added + ' 场，跳过重复 ' + res.dup + ' 场', 'ok', 4200);
      } catch (e) {
        U.toast('存档恢复失败：' + e.message, 'err');
      }
    }
  }

  function renderBatches() {
    const host = $('#batchList');
    host.innerHTML = '';
    if (!store.batches.length) return;

    store.batches.slice().reverse().forEach(function (b) {
      const item = U.el('div', { class: 'batch-item' }, [
        U.el('span', { class: 'bi-name', title: b.name, text: b.name }),
        U.el('span', { class: 'bi-count', text: '+' + (b.added || 0) }),
        U.el('span', { class: 'bi-gen', title: '把这一批转换成内置示例数据', text: '⇩' }),
        U.el('span', { class: 'bi-del', title: '移除这一批数据', text: '✕' })
      ]);
      item.querySelector('.bi-del').addEventListener('click', function () {
        const removed = store.removeBatch(b.id);
        renderBatches();
        clearSelection();
        recompute(true);
        U.toast('已移除 <b>' + b.name + '</b> 的 ' + removed + ' 场记录。');
      });
      item.querySelector('.bi-gen').addEventListener('click', function () {
        openGenDrawer(b.id);
      });
      host.appendChild(item);
    });
  }

  /* ================= 生成内置数据 ================= */

  const genState = { open: false, source: 'all', result: null };

  function collectSourceBattles(value) {
    if (!value || value === 'all') return store.battles.slice();
    const bid = value.indexOf('batch:') === 0 ? value.slice(6) : value;
    return store.battles.filter(function (b) { return b.batchId === bid; });
  }

  function sourceLabel(value) {
    if (!value || value === 'all') return '全部累计数据';
    const bid = value.indexOf('batch:') === 0 ? value.slice(6) : value;
    const b = store.batches.find(function (x) { return x.id === bid; });
    return b ? b.name : '未知批次';
  }

  function buildSourceOptions() {
    const sel = $('#genSource');
    sel.innerHTML = '';
    sel.appendChild(U.el('option', {
      value: 'all',
      text: '全部累计数据（' + store.battles.length + ' 场 / ' + store.batches.length + ' 份表）'
    }));
    store.batches.slice().reverse().forEach(function (b) {
      const n = store.battles.filter(function (x) { return x.batchId === b.id; }).length;
      sel.appendChild(U.el('option', {
        value: 'batch:' + b.id,
        text: '仅「' + b.name + '」（' + n + ' 场）'
      }));
    });
    const prefer = sel.querySelector('option[value="' + genState.source + '"]');
    sel.value = prefer ? genState.source : 'all';
    genState.source = sel.value;
  }

  /** 战斗记录 -> 标准列 -> 脱敏 -> CSV 文本 / sample-data.js 文本 */
  function computeConversion() {
    const battles = collectSourceBattles(genState.source);
    // 明细数据要保持明细形态导出，否则武将 / 技能信息会被降级抹掉
    const detailed = AC.detail.hasDetail(battles);
    const header = detailed ? AC.detail.DETAIL_HEADER.slice() : AC.model.CSV_HEADER.slice();
    const rows = detailed
      ? AC.detail.toRows(battles)
      : battles.map(function (b) { return AC.model.battleToRow(b); });

    const opts = {
      anonNames: $('#genAnon').checked,
      anonId: $('#genAnonId').checked,
      anonPlace: $('#genAnonPlace').checked
    };

    const plan = AC.anonymize.buildPlan(header, rows, {});
    const applied = AC.anonymize.applyPlan(header, rows, plan, opts);
    const csv = AC.anonymize.toCsvText(applied.header, applied.rows);
    const js = buildSampleJs(csv, sourceLabel(genState.source), applied.stats, opts, {
      detailed: detailed, battles: battles.length
    });

    genState.result = {
      battles: battles, header: header, rows: rows,
      applied: applied, csv: csv, js: js, plan: plan, opts: opts
    };
    return genState.result;
  }

  function buildSampleJs(csvText, sourceName, stats, opts, meta) {
    meta = meta || {};
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    const stamp = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    const anonDesc = opts.anonNames
      ? '已脱敏（假名由原始名的 MD5 派生，跨批次恒定可匹配）'
      : '⚠ 未脱敏，含真实同盟 / 玩家名';
    const sizeDesc = meta.detailed
      ? (stats.rows || 0) + ' 行武将明细（' + (meta.battles || 0) + ' 场战斗）'
      : (stats.rows || 0) + ' 场战斗';
    const banner = [
      '/* 内置示例战报表（由页面「生成内置数据」导出，勿手改）',
      '   来源：' + sourceName,
      '   生成时间：' + stamp,
      '   数据：' + sizeDesc + ' · ' + anonDesc,
      '   用法：覆盖到 js/sample-data.js，刷新页面即可生效；',
      '         同时把「配套 CSV」覆盖到 samples/' + (meta.detailed ? 'alliance_detail_sample.csv' : 'alliance_battles_sample.csv') + '；',
      '         页面左上「载入示例表」与 index.html?demo=1 都会使用它。 */',
      'window.AC = window.AC || {};',
      'window.AC.sampleCsv = '
    ].join('\n');
    return banner + JSON.stringify(csvText) + ';\n';
  }

  function renderGenPreview() {
    const r = computeConversion();
    const host = $('#genPreview');
    host.innerHTML = '';

    const st = r.applied.stats;
    const lines = [
      ['数据规模', AC.detail.hasDetail(r.battles)
        ? (r.applied.rows.length + ' 行武将明细 / ' + r.battles.length + ' 场战斗')
        : (r.applied.rows.length + ' 场战斗')],
      ['数据来源', sourceLabel(genState.source)],
      ['不同玩家', r.plan.stats.players + ' 个'],
      ['不同同盟', r.plan.stats.alliances + ' 个'],
      ['脱敏替换', r.opts.anonNames
        ? st.playerReplacements + ' 处玩家 / ' + st.allianceReplacements + ' 处同盟'
        : '未脱敏'],
      ['输出体积', (r.js.length / 1024).toFixed(0) + ' KB']
    ];
    lines.forEach(function (p) {
      host.appendChild(U.el('div', { class: 'gp-row' }, [
        U.el('span', { text: p[0] }),
        U.el('b', { text: p[1] })
      ]));
    });

    const preview = [r.applied.header.slice(0, 8).join(' | ')]
      .concat(r.applied.rows.slice(0, 3).map(function (row) {
        return row.slice(0, 8).map(function (v) { return String(v).slice(0, 12); }).join(' | ');
      }));
    host.appendChild(U.el('div', { class: 'gp-code', text: preview.join('\n') + '\n…（仅显示前 8 列 / 前 3 行）' }));

    if (r.plan.stats.missing.length) {
      host.appendChild(U.el('p', { class: 'hint gp-warn', text: '缺少列：' + r.plan.stats.missing.join('、') }));
    }
    if (!r.opts.anonNames) {
      host.appendChild(U.el('p', { class: 'hint gp-warn', text: '⚠ 当前未脱敏：生成的内置数据会带上真实同盟 / 玩家名，分享项目时会外泄。' }));
    } else {
      host.appendChild(U.el('p', { class: 'hint gp-ok', text: '✓ 已脱敏：可安全随项目分发。' }));
    }
  }

  function openGenDrawer(batchId) {
    if (!store.battles.length) {
      U.toast('还没有数据，先导入战报表或点击「载入示例表」。', 'err');
      return;
    }
    if (batchId) genState.source = 'batch:' + batchId;
    genState.open = true;
    buildSourceOptions();
    renderGenPreview();
    $('#genMask').classList.add('open');
    $('#genDrawer').classList.add('open');
    $('#genDrawer').setAttribute('aria-hidden', 'false');
  }

  function closeGenDrawer() {
    genState.open = false;
    $('#genMask').classList.remove('open');
    $('#genDrawer').classList.remove('open');
    $('#genDrawer').setAttribute('aria-hidden', 'true');
  }

  function downloadGenJs() {
    const r = genState.result || computeConversion();
    U.downloadText('sample-data.js', r.js, 'text/javascript;charset=utf-8');
    U.toast('已导出 <b>sample-data.js</b>，请覆盖到项目的 <b>js/sample-data.js</b>，刷新页面即可生效。', 'ok', 5600);
  }

  function downloadGenCsv() {
    const r = genState.result || computeConversion();
    // 文件名与项目里 samples/ 下的示例表保持一致，覆盖时不会对不上
    const detailed = AC.detail.hasDetail(r.battles);
    const name = detailed ? 'alliance_detail_sample.csv' : 'alliance_battles_sample.csv';
    U.downloadText(name, r.csv, 'text/csv;charset=utf-8');
    U.toast('已导出配套 CSV（<b>' + name + '</b>），可覆盖 <b>samples/' + name + '</b>，与 sample-data.js 一起提交。', 'ok', 5600);
  }

  /* ================= 重算与刷新 ================= */

  function recompute(withAnim) {
    state.result = AC.analyzer.analyze(store.battles, filters);

    const r = state.result;
    $('#graphEmpty').style.display = r.stats.totalKept ? 'none' : 'flex';

    graph.setData(r, { topN: filters.topN });
    matrix.setData(r, { topN: filters.topN });
    rank.render(r);
    if (allianceView) allianceView.render(r);
    if (heroesView) heroesView.render(r);
    table.setData(r.battles);
    updateStats(r, withAnim);

    // 保持选中同步
    if (state.selection && state.selection.type === 'node' && r.nodeMap.has(state.selection.id)) {
      graph.setSelection(state.selection);
    } else if (state.selection) {
      const e = graph.edges.find(function (x) { return x.id === state.selection.id; });
      if (e) graph.setSelection(state.selection);
    }

    $('#filterStat').textContent = r.stats.totalKept + ' 场生效';
    $('#legend').innerHTML = filters.dimension === 'comp'
      ? '<span class="legend-item"><span class="legend-bar"></span>被克 &rarr; 均衡 &rarr; 克</span>' +
        '<span class="legend-item legend-extra">节点大小 = 出场次数</span>' +
        '<span class="legend-item legend-extra">流动方向 = 克制方向</span>'
      : '<span class="legend-item"><span class="legend-bar"></span>被克 &rarr; 均衡 &rarr; 克</span>' +
        '<span class="legend-item legend-extra">节点大小 = 出场次数</span>';
    updateFoot();
  }

  function updateStats(r, withAnim) {
    const s = r.stats;
    setNum('#statBattles', s.totalKept, withAnim);
    setNum('#statNodes', s.nodeShown, withAnim);
    setNum('#statEdges', s.edgeCount, withAnim);
    setNum('#statPairs', s.pairCount, withAnim);
    setNum('#statBatches', store.batches.length, withAnim);

    const sum = $('#dataSummary');
    if (!store.battles.length) {
      sum.textContent = '尚未导入数据';
    } else {
      let t = '累计 ' + store.battles.length + ' 场 · ' + store.batches.length + ' 份表';
      if (s.timeFrom) {
        const f = new Date(s.timeFrom), to = new Date(s.timeTo);
        t += ' · ' + fmtTime(f) + ' ~ ' + fmtTime(to);
      }
      sum.textContent = t;
    }
  }

  function fmtTime(d) {
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function setNum(sel, value, withAnim) {
    const node = $(sel);
    if (withAnim) U.countTo(node, value, 560);
    else node.textContent = U.fmtInt(value);
  }

  function updateFoot() {
    const r = state.result;
    if (!r) return;
    const s = r.stats;
    const parts = [];
    parts.push('生效对局 ' + s.totalKept + ' / ' + s.totalInput + ' 场');
    if (s.skippedMirror) parts.push('排除内战 ' + s.skippedMirror + ' 场');
    if (s.skippedFilter) parts.push('样本过滤 ' + s.skippedFilter + ' 场');
    if (s.skipped) parts.push('无法识别 ' + s.skipped + ' 场');
    parts.push('平均 ' + s.avgRound.toFixed(1) + ' 回合');
    parts.push('阵容 ' + s.nodeShown + ' / 共 ' + s.nodeCount + ' 个已展示');
    parts.push('对阵组合 ' + s.pairCount + ' 组 · 有向克制 ' + s.edgeCount + ' 条');
    if (s.edgeDropped.byPair) parts.push('因样本不足隐藏 ' + s.edgeDropped.byPair + ' 组');
    parts.push('小样本已按 n/(n+' + r.opts.shrinkK + ') 收缩');
    $('#stageFoot').innerHTML = parts.map(function (p) { return '<span>' + p + '</span>'; }).join('');
  }

  /* ================= 选择与详情 ================= */

  function clearSelection() {
    state.selection = null;
    graph.setSelection(null);
    matrix.setSelection(null);
    $("#inspector").innerHTML = '';
    $("#inspector").appendChild(U.el('div', { class: 'inspector-empty' }, [
      U.el('h3', { text: '选中一个节点或一条连线' }),
      U.el('p', { text: '点击网络图中的节点 / 连线，或矩阵中的格子，这里会显示胜率拆解、攻守差异与原始战报明细。' })
    ]));
  }

  function selectNode(key, fromRank) {
    const r = state.result;
    const node = r.nodeMap.get(key);
    if (!node) return;
    state.selection = { type: 'node', id: key };
    graph.setSelection(state.selection);
    matrix.setSelection({ type: 'node', id: key });
    if (!fromRank) matrix.setSelection({ type: 'node', id: key });
    renderNodeInspector(node);
  }

  function renderNodeInspector(node) {
    const r = state.result;
    const insp = $('#inspector');
    insp.innerHTML = '';

    insp.appendChild(U.el('div', { class: 'insp-head' }, [
      U.el('div', { class: 'insp-kicker', text: filters.dimension === 'comp' ? '阵容详情' : '阵型详情' }),
      U.el('h2', { class: 'insp-title' }, [U.compWithTroop(node.display, node.troopSig)])
    ]));

    insp.appendChild(U.el('div', { class: 'insp-grid' }, [
      cell('出场', node.n + ' 场'),
      cell('胜率', U.fmtPct(node.rate, 1)),
      cell('战绩', node.win + '胜 ' + node.loss + '负 ' + node.draw + '平'),
      cell('净压制力', U.fmtSigned(node.netPower, 1)),
      cell('场均战损', U.fmtShort(node.avgCostOut)),
      cell('战损比', node.exchange === null ? '-' : node.exchange.toFixed(2))
    ]));

    // 常用阵型分布（阵容维度下才有意义）
    if (filters.dimension === 'comp' && Object.keys(node.formations).length) {
      insp.appendChild(mixSection('常用阵型', node.formations, node.n));
    }
    if (Object.keys(node.alliances).length) {
      insp.appendChild(mixSection('主要使用同盟', node.alliances, node.n));
    }

    const matchups = nodeMatchups(r, node);
    const good = matchups.filter(function (m) { return m.score > 0.02; }).sort(function (a, b) { return b.score - a.score; });
    const bad = matchups.filter(function (m) { return m.score < -0.02; }).sort(function (a, b) { return a.score - b.score; });

    insp.appendChild(matchList('克制的对手', good, true));
    insp.appendChild(matchList('被克制的对手', bad, false));

    // 最近战斗
    const recent = r.battles.filter(function (b) { return node.battleIds.indexOf(b.id) >= 0; })
      .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 6);
    if (recent.length) {
      const sec = U.el('div', { class: 'insp-section' }, [U.el('h4', { text: '最近对局' })]);
      recent.forEach(function (b) { sec.appendChild(battleMini(b, node.key)); });
      insp.appendChild(sec);
    }
  }

  function cell(k, v) {
    return U.el('div', { class: 'insp-cell' }, [
      U.el('div', { class: 'k', text: k }),
      U.el('div', { class: 'v', text: v })
    ]);
  }

  function mixSection(title, obj, total) {
    const entries = Object.keys(obj).map(function (k) { return { k: k, v: obj[k] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
    const sec = U.el('div', { class: 'insp-section' }, [U.el('h4', { text: title })]);
    entries.forEach(function (e) {
      const pct = e.v / total;
      sec.appendChild(U.el('div', { class: 'vs-row', style: { cursor: 'default' } }, [
        U.el('span', { class: 'vs-name', text: e.k }),
        U.el('span', { class: 'vs-n', text: e.v + ' 场' }),
        U.el('span', { class: 'vs-rate', text: U.fmtPct(pct, 0) })
      ]));
    });
    return sec;
  }

  function matchList(title, list, positive) {
    const sec = U.el('div', { class: 'insp-section' }, [U.el('h4', { text: title + '（' + list.length + '）' })]);
    if (!list.length) {
      sec.appendChild(U.el('div', { class: 'hint', text: '暂无显著样本' }));
      return sec;
    }
    list.slice(0, 12).forEach(function (m) {
      const row = U.el('div', { class: 'vs-row' }, [
        U.el('div', { style: { flex: '1', minWidth: '0' } }, [
          U.el('div', { class: 'vs-name' }, [U.compWithTroop(m.name, m.troopSig)]),
          U.el('div', { class: 'mini-bar' }, [
            U.el('i', { style: { width: (m.rate * 100).toFixed(0) + '%', background: U.rateColor(m.rate) } })
          ])
        ]),
        U.el('span', { class: 'vs-rate', style: { color: positive ? '#ff8a9c' : '#6fc8ff' }, text: U.fmtPct(m.rate, 0) }),
        U.el('span', { class: 'vs-n', text: m.n + '场' })
      ]);
      row.addEventListener('click', function () { selectNode(m.key); });
      sec.appendChild(row);
    });
    return sec;
  }

  function nodeMatchups(r, node) {
    const out = [];
    node.opponents.forEach(function (o, otherKey) {
      const p = AC.analyzer.getPair(r, node.key, otherKey);
      if (!p) return;
      const mine = p.lo === node.key ? p.score : -p.score;
      const other = r.nodeMap.get(otherKey);
      const denom = filters.excludeDraw ? (o.win + o.loss) : o.n;
      const rate = denom ? (o.win + (filters.excludeDraw ? 0 : o.draw * 0.5)) / denom : 0.5;
      out.push({
        key: otherKey,
        name: other ? other.display : otherKey,
        troopSig: other ? other.troopSig : '',
        n: o.n, win: o.win, loss: o.loss, draw: o.draw,
        rate: rate, score: mine, pair: p
      });
    });
    return out;
  }

  function showPair(k1, k2) {
    const r = state.result;
    const p = AC.analyzer.getPair(r, k1, k2);
    if (!p) { return; }
    const A = r.nodeMap.get(k1), B = r.nodeMap.get(k2);
    const nameA = A ? A.display : k1, nameB = B ? B.display : k2;
    const insp = $('#inspector');
    insp.innerHTML = '';

    const rateA = p.rateLo;
    insp.appendChild(U.el('div', { class: 'insp-head' }, [
      U.el('div', { class: 'insp-kicker', text: '对阵详情' }),
      U.el('div', { class: 'insp-title' }, [
        U.el('div', {}, [U.compWithTroop(nameA, A ? A.troopSig : '')]),
        U.el('div', { style: { color: '#8fa3c4', fontSize: '12px', margin: '3px 0' }, text: 'VS' }),
        U.el('div', {}, [U.compWithTroop(nameB, B ? B.troopSig : '')])
      ])
    ]));

    const lead = rateA >= 0.5 ? nameA : nameB;
    const leadRate = rateA >= 0.5 ? rateA : 1 - rateA;
    insp.appendChild(U.el('div', {
      class: 'insp-cell',
      style: { marginBottom: '10px' }
    }, [
      U.el('div', { class: 'k', text: '优势方（已按样本收缩 ' + (p.conf * 100).toFixed(0) + '% 置信）' }),
      U.el('div', { class: 'v', style: { color: U.rateColor(leadRate), fontSize: '13px' }, text: lead + ' · ' + U.fmtPct(leadRate) })
    ]));

    insp.appendChild(U.el('div', { class: 'insp-grid' }, [
      cell('对局总数', p.n + ' 场'),
      cell('胜负平', p.winLo + ' / ' + p.winHi + ' / ' + p.draw),
      cell(nameA + ' 胜率', U.fmtPct(rateA)),
      cell('平均回合', p.avgRound.toFixed(1)),
      cell('损失率 A / B', U.fmtPct(p.lossLo, 0) + ' / ' + U.fmtPct(p.lossHi, 0)),
      cell('战损优势', p.lossGap === null ? '-' : U.fmtSigned(p.lossGap, 1))
    ]));

    // 攻守拆分
    const split = U.el('div', { class: 'insp-section' }, [U.el('h4', { text: '攻守拆分（先后手影响）' })]);
    split.appendChild(U.el('div', { class: 'vs-row', style: { cursor: 'default' } }, [
      U.el('span', { class: 'vs-name', text: nameA + ' 作攻方' }),
      U.el('span', { class: 'vs-n', text: p.nLoAsAtk + ' 场' }),
      U.el('span', { class: 'vs-rate', text: p.winLoRateAsAtk === null ? '-' : U.fmtPct(p.winLoRateAsAtk, 0) })
    ]));
    split.appendChild(U.el('div', { class: 'vs-row', style: { cursor: 'default' } }, [
      U.el('span', { class: 'vs-name', text: nameA + ' 作守方' }),
      U.el('span', { class: 'vs-n', text: p.nLoAsDef + ' 场' }),
      U.el('span', { class: 'vs-rate', text: p.winLoRateAsDef === null ? '-' : U.fmtPct(p.winLoRateAsDef, 0) })
    ]));
    insp.appendChild(split);

    // 培养度分层：同一对阵容在不同红度/品级下，克制关系可能完全相反
    const tierKeyOf = function (level) {
      return level < 1.5 ? 'low' : (level < 2.5 ? 'mid' : 'high');
    };
    const mkTierTable = function (title, list, unit, activeTier) {
      if (!list || list.length < 2) return null;
      const sec = U.el('div', { class: 'insp-section' }, [
        U.el('h4', { text: title }),
        U.el('p', { class: 'hint', style: { margin: '0 0 6px' }, text: '百分比是左侧那方（' + nameA + '）的胜率' })
      ]);
      const tb = U.el('div', { class: 'tier-table' });
      list.forEach(function (r) {
        tb.appendChild(U.el('div', { class: 'tt-row' + (tierKeyOf(r.level) === activeTier ? ' tt-active' : '') }, [
          U.el('div', { class: 'tt-label', text: '双方平均' + unit + ' ' + r.level }),
          U.el('div', { class: 'tt-bar' }, [
            U.el('i', { style: { width: (r.rateLo * 100) + '%', background: U.rateColor(r.rateLo) } })
          ]),
          U.el('div', { class: 'tt-n', text: r.n + ' 场' }),
          U.el('div', { class: 'tt-rate', style: { color: U.rateColor(r.rateLo) }, text: U.fmtPct(r.rateLo, 0) })
        ]));
      });
      sec.appendChild(tb);
      return sec;
    };
    const redT = mkTierTable('不同红度下的胜负', p.byRedList, '红度', filters.redTier);
    if (redT) insp.appendChild(redT);
    const pinT = mkTierTable('不同品级下的胜负', p.byPinList, '品级', filters.pinTier);
    if (pinT) insp.appendChild(pinT);

    // 原始对局
    const list = r.battles.filter(function (b) { return p.battleIds.indexOf(b.id) >= 0; })
      .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    const sec = U.el('div', { class: 'insp-section' }, [U.el('h4', { text: '原始对局（' + list.length + '）' })]);
    // 标出当前这对阵容里「左侧那套」是哪一边，方便对照胜负
    list.slice(0, 30).forEach(function (b) { sec.appendChild(battleMini(b, k1)); });
    if (list.length > 30) {
      sec.appendChild(U.el('div', { class: 'hint', text: '仅显示最近 30 条，完整记录见「原始战报」页。' }));
    }
    insp.appendChild(sec);
  }

  function battleMini(b, focusKey) {
    const time = b.time ? b.time.replace('T', ' ').slice(5, 16) : '-';
    // 胜负必须一眼可见：头部给结论标签，胜方那一行整行高亮
    const atkWon = b.result === 'atk';
    const defWon = b.result === 'def';
    const resText = atkWon ? '攻方胜' : (defWon ? '守方胜' : '平局');
    const resCls = atkWon ? 'atk' : (defWon ? 'def' : 'draw');

    const sideRow = function (role, side, won) {
      const focus = focusKey && side.key === focusKey;
      return U.el('div', { class: 'bm-side' + (won ? ' bm-won' : '') + (focus ? ' bm-focus' : '') }, [
        U.el('span', { class: 'bm-tag bm-tag-' + role, text: role === 'atk' ? '攻' : '守' }),
        won ? U.el('span', { class: 'bm-crown', text: '胜' }) : null,
        U.el('span', { class: 'bm-player', text: side.player || '-' }),
        U.compWithTroop(side.compRaw || '-', side.troopSig, 'bm-comp'),
        U.el('span', { class: 'bm-form', text: side.formation || '' })
      ]);
    };

    const node = U.el('div', { class: 'battle-mini' }, [
      U.el('div', { class: 'bm-head' }, [
        U.el('span', { text: time }),
        U.el('span', { class: 'mb-result ' + resCls, text: resText }),
        U.el('span', { text: (b.place || '-') + ' · ' + (b.round === null ? '-' : b.round) + ' 回合' })
      ]),
      sideRow('atk', b.atk, atkWon),
      sideRow('def', b.def, defWon),
      U.el('div', { class: 'bm-meta', text: '伤/亡  攻 ' + U.fmtInt(b.atk.wounded) + '/' + U.fmtInt(b.atk.dead) + '   守 ' + U.fmtInt(b.def.wounded) + '/' + U.fmtInt(b.def.dead) }),
      (b.atk.redDist || b.atk.pinDist) ? U.el('div', { class: 'bm-meta', text: '红度/品级  攻 ' + rp(b.atk) + '   守 ' + rp(b.def) }) : null
    ]);
    return node;
  }

  /** 红度/品级串，如 1·1·0 / 1·0·0 */
  function rp(side) {
    const red = (side.redDist && side.redDist.length) ? side.redDist.join('·') : '-';
    const pin = (side.pinDist && side.pinDist.length) ? side.pinDist.join('·') : '-';
    return red + ' / ' + pin;
  }

  /* ================= 悬浮提示 ================= */

  function showGraphTip(info) {
    const tip = $('#graphTip');
    if (!info) { tip.classList.remove('show'); return; }
    let html = '';
    if (info.type === 'node') {
      const nd = state.result.nodeMap.get(info.id);
      if (!nd) return;
      html = '<b>' + esc(nd.display) + '</b>' + U.troopHtml(nd.troopSig) +
        '<br>出场 ' + nd.n + ' 场 · 胜率 ' + U.fmtPct(nd.rate) +
        '<br>净压制力 ' + U.fmtSigned(nd.netPower) +
        (nd.mainFormation ? '<br>常用阵型 ' + esc(nd.mainFormation) : '') +
        (nd.redAvg !== null && nd.redAvg !== undefined ? '<br>平均红度 ' + nd.redAvg.toFixed(2) : '');
    } else {
      const e = graph.edges.find(function (x) { return x.id === info.id; });
      if (!e) return;
      const a = state.result.nodeMap.get(e.source), b = state.result.nodeMap.get(e.target);
      html = '<b>' + esc(a ? a.display : e.source) + '</b>' + U.troopHtml(a ? a.troopSig : '') +
        ' 克 <b>' + esc(b ? b.display : e.target) + '</b>' + U.troopHtml(b ? b.troopSig : '') +
        '<br>胜率 ' + U.fmtPct(e.rate) + ' · 对局 ' + e.n + ' 场' +
        '<br>样本置信 ' + U.fmtPct(e.data.conf, 0);
    }
    tip.innerHTML = html;
    tip.classList.add('show');
    tip.style.left = Math.min(info.screen.x + 16, $('#view-graph').clientWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.min(info.screen.y + 14, $('#view-graph').clientHeight - tip.offsetHeight - 8) + 'px';
  }

  function showMatrixTip(info) {
    const tip = $('#matrixTip');
    if (!info) { tip.classList.remove('show'); return; }
    tip.innerHTML = info.html;
    tip.classList.add('show');
    tip.style.left = Math.min(info.screen.x + 16, $('#view-matrix').clientWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.min(info.screen.y + 14, $('#view-matrix').clientHeight - tip.offsetHeight - 8) + 'px';
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
  }

  /* ================= 视图切换与导出 ================= */

  function switchView(name) {
    state.view = name;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    // 画布在隐藏期间会丢失合成内容，切换回来必须主动重绘
    if (name === 'matrix') matrix.redraw();
    if (name === 'graph') graph.refresh();
  }

  function exportPng() {
    const cv = state.view === 'matrix' ? $('#matrixCanvas') : $('#graphCanvas');
    if (!cv.width) { U.toast('当前视图没有内容可导出。', 'err'); return; }
    const out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(cv, 0, 0);
    out.toBlob(function (blob) {
      U.downloadBlob('克制关系图_' + U.stamp() + '.png', blob);
      U.toast('已导出 PNG。', 'ok');
    }, 'image/png');
  }

  function exportArchive() {
    if (!store.battles.length) { U.toast('没有数据可导出。', 'err'); return; }
    U.downloadText('战报累计存档_' + U.stamp() + '.json', store.exportJSON(), 'application/json;charset=utf-8');
    U.toast('已导出存档，下次用「恢复存档」即可继续叠加。', 'ok');
  }

  document.addEventListener('DOMContentLoaded', init);

  /* ================= 版本与缓存自检 ================= */

  const BUILD = '20261011j';

  /**
   * 仓库改动后浏览器可能仍用缓存的旧 js/css，导致新功能（如兵种徽章）不显示。
   * 这里把版本号显示在标题旁，并探测新版 CSS 是否真的生效——
   * 如果样式来自缓存，会明确提示用户强制刷新。
   */
  function checkBuild() {
    const tag = document.getElementById('buildTag');
    if (!tag) return;
    tag.textContent = 'v' + BUILD;
    tag.title = '当前版本 ' + BUILD;

    const probe = document.createElement('span');
    probe.className = 'troop t-gong';
    probe.style.cssText = 'position:absolute;visibility:hidden;';
    document.body.appendChild(probe);
    const w = window.getComputedStyle(probe).width;
    document.body.removeChild(probe);

    if (w !== '15px') {
      tag.textContent = 'v' + BUILD + ' · 样式是旧缓存';
      tag.classList.add('stale');
      tag.title = 'CSS 被浏览器缓存了：按 Ctrl+F5（或 Ctrl+Shift+R）强制刷新即可看到兵种徽章等新样式';
      if (window.console) {
        console.warn('[AC] 检测到样式来自浏览器缓存（.troop 规则未生效），请按 Ctrl+F5 强制刷新。');
      }
    }
  }

  // 暴露给测试脚本 / 二次开发使用
  AC.app = {
    store: store,
    filters: filters,
    state: state,
    genState: genState,
    ingest: ingest,
    importFiles: importFiles,
    decodeBuffer: decodeBuffer,
    recompute: recompute,
    switchView: switchView,
    selectNode: selectNode,
    showPair: showPair,
    clearSelection: clearSelection,
    openGenDrawer: openGenDrawer,
    closeGenDrawer: closeGenDrawer,
    computeConversion: computeConversion,
    graphRef: function () { return graph; },
    matrixRef: function () { return matrix; },
    allianceRef: function () { return allianceView; },
    heroesRef: function () { return heroesView; },
    build: BUILD
  };

  // 「检查更新」按钮（js/update.js）
  if (AC.updateInit) {
    document.addEventListener('DOMContentLoaded', AC.updateInit);
  }
})(window.AC);
