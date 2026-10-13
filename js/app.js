window.AC = window.AC || {};

/* ============================================================
   主控：导入 -> 分析 -> 渲染 的调度
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;
  const $ = U.$;
  const $$ = U.$$;

  // 启动时不自动恢复上次存档：默认展示内置数据（旧存档会先备份，可用「载入上次数据」找回）
  const store = new AC.Store();

  const filters = {
    dimension: 'comp',
    minPair: 2,
    minAppear: 3,
    minLevel: 40,
    onlyFull: true,
    onlyForceParity: true,  // 只看双方总兵力接近的对局（关掉才有「以少打多」样本，劣势分才有意义）
    forceParityGap: 3000,   // 兵力差距阈值
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

  let graph = null, matrix = null, rank = null, table = null, allianceView = null, heroesView = null, mirrorView = null, gearView = null, playerView = null;

  /* ================= 初始化 ================= */

  function init() {
    checkBuild();

    table = new AC.Table($('#dataTable'), $('#tablePager'));

    rank = new AC.Rank($('#rankWrap'), {
      onSelect: function (sel) { selectNode(sel.id, true); },
      onStreakLog: function (node, run) { openStreakLog(node, run); }
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

      // 内战分析：唯一能控制「阵容」变量的场景，专门看配置差异的影响。
  // 数据源用 store.battles —— 主分析默认排除了内战，这里必须拿全量。
  mirrorView = new AC.MirrorView($('#mirrorList'), $('#mirrorDetail'));
  gearView = new AC.GearView($('#gearWrap'));
  playerView = new AC.PlayerView($('#playerList'), $('#playerDetail'), {});
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

    // 验证用 / 便捷入口：#rec 选中第一个阵容并打开「推荐配置」浮窗
    if (location.hash === '#rec') {
      setTimeout(function () {
        if (state.result && state.result.nodeList.length && graph && graph.cb && graph.cb.onSelect) {
          graph.cb.onSelect({ type: 'node', id: state.result.nodeList[0].key });
        }
        setTimeout(function () {
          const btn = document.querySelector('.insp-btn');
          if (btn) btn.click();
          // 再验证排序切换：记录「按场次」与「按胜率」下的首套配置
          setTimeout(function () {
            const read = function () {
              const head = document.querySelector('.hc-cfg-head');
              const sub = document.querySelector('.hc-count');
              return (head ? head.textContent.replace(/\s+/g, ' ').trim() : '-') + ' ｜ ' +
                (sub ? sub.textContent.trim() : '-');
            };
            const byN = read();
            const btns = document.querySelectorAll('.hc-sort-btn');
            if (btns[1]) btns[1].click();
            const byRate = read();
            document.title = 'SORTTEST 按场次[' + byN + '] 按胜率[' + byRate + ']';
          }, 800);
        }, 700);
      }, 1500);
    }

    // 验证用：#pfTest 依次叠加「红度多选」「最低场次」筛选，检查主力玩家表格是否联动
    if (location.hash === '#pfTest') {
      setTimeout(function () {
        const sumOf = function () {
          const el = document.querySelector('.pt-sum');
          return el ? el.textContent.trim() : '(无)';
        };
        const a0 = sumOf();
        const reds = document.querySelectorAll('.ptf-red');
        if (reds[1]) reds[1].click();      // 1 红
        if (reds[2]) reds[2].click();      // 2 红
        const a1 = sumOf();
        const ranges = document.querySelectorAll('.pt-filter input[type=range]');
        if (ranges[0]) { ranges[0].value = '20'; ranges[0].dispatchEvent(new Event('input', { bubbles: true })); }
        const a2 = sumOf();
        const rows = document.querySelectorAll('.pt-filter ~ div .at-row').length;
        const reset = document.querySelector('.ptf-reset');
        if (reset) reset.click();
        const a3 = sumOf();
        document.title = 'PFTEST 初始[' + a0 + '] +1红2红[' + a1 + '] +场次≥20[' + a2 + '] 行数' + rows + ' 重置后[' + a3 + ']';
      }, 1600);
    }

    // 验证用：#forceTest 关闭兵力过滤，检查「均势/以多打少/以少打多」三档分层是否正确
    if (location.hash === '#forceTest') {
      setTimeout(function () {
        filters.onlyForceParity = false;
        filters.minAppear = 3;
        if (typeof syncControls === 'function') syncControls();
        recompute();
        setTimeout(function () {
          // 三种设置下的保留场次应当满足：不限 与 关闭开关 完全一致
          const probe = function (on, gap) {
            const f2 = Object.assign({}, filters, { onlyForceParity: on, forceParityGap: gap });
            return AC.analyzer.analyze(store.battles, f2).battles.length;
          };
          const r3000 = probe(true, 3000);
          const rUnlimited = probe(true, -1);
          const rOff = probe(false, 3000);
          // 用「不限」跑一遍，看三档分层是否恢复（说明分层阈值已与过滤解耦）
          const rShow = AC.analyzer.analyze(store.battles, Object.assign({}, filters, { onlyForceParity: true, forceParityGap: -1 }));
          state.result = rShow;
          const nodes = state.result.nodeList.slice()
            .sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
          document.title = 'FORCETEST gap3000=' + r3000 + ' gap不限=' + rUnlimited + ' 关开关=' + rOff +
            ' 不限等于关开关:' + (rUnlimited === rOff ? '是' : '否') + ' || ' + nodes.map(function (n) {
            return n.display.replace(/\s/g, '').slice(0, 10) +
              ' 均' + n.byForce.even.n + '/多' + n.byForce.adv.n + '/少' + n.byForce.dis.n +
              ' 总' + U.fmtPct(n.rate, 0) +
              ' 公平' + (n.rateFair === null ? '-' : U.fmtPct(n.rateFair, 0)) +
              ' 压' + U.fmtSigned(n.netPowerFair, 1);
          }).join(' || ');
        }, 700);
      }, 1400);
    }

    // URL 带 #g3d 直接切到 3D（便于查看 / 分享）；#dragtest 额外做拖动自检
    if (location.hash === '#g3d') {
      setTimeout(function () {
        const b = document.querySelector('#graphModeSeg .seg-btn[data-mode="3d"]');
        if (b) b.click();
      }, 1000);
    }

    // 验证用：URL 带 #dragtest 时切到 3D，模拟右键拖动，把位移写进标题
    if (location.hash === '#dragtest') {
      setTimeout(function () {
        const b = document.querySelector('#graphModeSeg .seg-btn[data-mode="3d"]');
        if (b) b.click();
        setTimeout(function () {
          const cv = $('#graphCanvas');
          if (!cv) { document.title = 'DRAGTEST no-canvas'; return; }
          const r = cv.getBoundingClientRect();
          const fire = function (type, x, y, button) {
            cv.dispatchEvent(new MouseEvent(type, {
              clientX: r.left + x, clientY: r.top + y, button: button, bubbles: true, cancelable: true
            }));
          };
          const before = { x: graph.view.x, y: graph.view.y, yaw: graph.yaw };
          // 右键拖动：应当只平移画布，不改变 yaw/pitch
          fire('mousedown', 300, 300, 2);
          fire('mousemove', 350, 330, 2);
          fire('mousemove', 400, 360, 2);
          window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
          const afterPan = { x: graph.view.x, y: graph.view.y, yaw: graph.yaw };
          // 左键拖动：应当只旋转视角，不改变 view.x/y
          fire('mousedown', 300, 300, 0);
          fire('mousemove', 360, 300, 0);
          window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
          document.title = 'DRAGTEST pan=(' + (afterPan.x - before.x) + ',' + (afterPan.y - before.y) +
            ') panYawDelta=' + (afterPan.yaw - before.yaw).toFixed(4) +
            ' rotYawDelta=' + (graph.yaw - afterPan.yaw).toFixed(4) +
            ' rotViewXDelta=' + (graph.view.x - afterPan.x).toFixed(2);

          // 俯仰翻滚测试：连续向下拖 5 次共 500px，看 pitch 是否折返、yaw 是否持续累加
          const y0 = graph.yaw, p0 = graph.pitch;
          let maxAbsPitch = 0;
          for (let i = 0; i < 5; i++) {
            fire('mousedown', 300, 200 + i * 40, 0);
            fire('mousemove', 300, 300 + i * 40, 0);
            window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
            maxAbsPitch = Math.max(maxAbsPitch, Math.abs(graph.pitch));
          }
          document.title += ' || PITCH p0=' + p0.toFixed(2) + ' p1=' + graph.pitch.toFixed(2) +
            ' maxAbs=' + maxAbsPitch.toFixed(2) + ' limit=' + (Math.PI / 2).toFixed(2) +
            ' yawDelta=' + (graph.yaw - y0).toFixed(2) + ' (PI=' + Math.PI.toFixed(2) + ')';

        }, 700);
      }, 1200);
    }
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
            ? '左键拖动旋转视角 · 右键拖动平移画布 · 滚轮缩放 · 高度 = 强度分（公平压制力 + 打赢面）'
            : '2D 更适合看清克制关系';
        }
      });
    });

    bindUI();
    renderDataSource();
    recompute(true);

    const params = new URLSearchParams(location.search);

    // 备份内置数据引用：上传会覆盖 AC.battleData，「移除上传」时要还原
    window.__builtinBattleData = AC.battleData || null;

    /* 数据加载策略（优先级从高到低）：
       ① 用户上传的数据（IndexedDB 持久化，页面拖入/选择后保存）
       ② 内置数据文件 js/battle-data.js（window.AC.battleData）
       ③ 缓存的转换结果（来自①或②的某个历史版本）
       ④ 都没有就提示用户上传或去 sanmou-viewer 导出 */
    function bootFromUpload(res) {
      // 恢复上传数据到 battleData 再统一装载
      AC.battleData = res.data;
      setBusy('正在读取上传的战报数据…', '');
      nextPaint(function () {
        try {
          const r = store.loadFromBattleData({ uploaded: true });
          renderDataSource();
          recompute(true);
          store.save();
          U.toast('已载入 <b>' + r.count + '</b> 场战报（上传数据，'
            + new Date(res.savedAt).toLocaleString('zh-CN') + ' 导入）', 'ok', 5200);
        } catch (e) {
          U.toast('载入上传数据失败：' + e.message, 'err', 6000);
        } finally {
          hideBusy();
          bootFinish();
        }
      });
    }

    Promise.resolve(store.loadUploaded()).then(function (up) {
      if (up && up.ok) { bootFromUpload(up); return; }

      // 无上传数据：看内置文件
      const diag = AC.sanmou.diagnose();
      if (diag.ok) {
        setBusy('正在读取战报数据…', '数据量较大时会短暂无响应');
        nextPaint(function () {
          try {
            const res = store.loadFromBattleData();
            renderDataSource();
            recompute(true);
            store.save();                      // 后台缓存，下次秒开
            U.toast('已载入 <b>' + res.count + '</b> 场战报（完整交战 '
              + (res.meta && res.meta.blocks ? res.meta.blocks : '-') + ' 场）', 'ok', 4600);
          } catch (e) {
            U.toast('载入战报数据失败：' + e.message, 'err', 6000);
          } finally {
            hideBusy();
            bootFinish();
          }
        });
        return;
      }

      // 无内置文件：尝试缓存
      Promise.resolve(store.loadCache()).then(function (r) {
        if (r && r.ok) {
          renderDataSource();
          recompute(true);
          U.toast('已从缓存载入 ' + r.count + ' 场战报（未检测到数据文件）。', '', 4200);
        } else if (diag.reason !== 'missing') {
          U.toast(diag.message, 'err', 8000);
        }
        bootFinish();
      });
    });
    return;

    /** 首屏收尾：处理 URL 参数、空数据提示，并撤掉启动遮罩 */
    function bootFinish() {
      if (params.get('view')) switchView(params.get('view'));
      if (params.get('topn')) {
        filters.topN = Number(params.get('topn')) || filters.topN;
        syncControls();
        recompute();
      }
      if (!store.battles.length) {
        $('#graphEmpty').style.display = 'flex';
        const d = AC.sanmou.diagnose();
        U.toast(d.message, 'err', 9000);
      }
      // 首屏数据就绪：撤掉 index.html 里的启动加载提示
      if (window.__bootReady) window.__bootReady();
    }
  }

  /* ---------------- 忙碌遮罩 ----------------
     下载 / 解析大文件都是重活：解析是同步的，会把主线程占住几百毫秒到几秒。
     所以必须先让遮罩画出来（nextPaint 让出一次主线程），再开始干活，
     否则遮罩根本没机会渲染，用户看到的就是「点了没反应」。 */
  let busyMask = null, busyTitle = null, busyTip = null;
  function showBusy(title, tip) {
    if (busyMask) { setBusy(title, tip); return; }
    busyTitle = U.el('div', { class: 'busy-title', text: title || '处理中…' });
    busyTip = U.el('div', { class: 'busy-tip', text: tip || '' });
    busyMask = U.el('div', { class: 'busy-mask' }, [
      U.el('div', { class: 'busy-box' }, [
        U.el('div', { class: 'busy-spin' }),
        busyTitle,
        busyTip
      ])
    ]);
    document.body.appendChild(busyMask);
  }
  function setBusy(title, tip) {
    if (busyTitle && title) busyTitle.textContent = title;
    if (busyTip && tip !== undefined) busyTip.textContent = tip;
  }
  function hideBusy() {
    if (busyMask && busyMask.parentNode) busyMask.parentNode.removeChild(busyMask);
    busyMask = null; busyTitle = null; busyTip = null;
  }
  /** 让浏览器先把界面画出来（遮罩能被看见），再执行会阻塞主线程的解析 */
  function nextPaint(fn) {
    requestAnimationFrame(function () { setTimeout(fn, 24); });
  }

  /* ================= UI 绑定 ================= */

  function bindUI() {
    // 数据源面板：重新载入 / 清空
    const btnReload = $('#btnReloadData');
    if (btnReload) {
      btnReload.addEventListener('click', function () {
        const diag = AC.sanmou.diagnose();
        if (!diag.ok) { U.toast(diag.message, 'err', 8000); return; }
        showBusy('正在重新载入战报数据…', '');
        nextPaint(function () {
          try {
            const res = store.loadFromBattleData();
            renderDataSource();
            clearSelection();
            recompute(true);
            store.save();
            U.toast('已重新载入 <b>' + res.count + '</b> 场战报。', 'ok', 4000);
          } catch (e) {
            U.toast('载入失败：' + e.message, 'err', 6000);
          } finally {
            hideBusy();
          }
        });
      });
    }

    /* ---------------- 上传 / 拖入数据文件 ----------------
       支持 sanmou-viewer 导出的 .js / .json / .jsonl。
       解析成功后保存到 IndexedDB，优先级高于内置数据文件。 */
    function handleUploadedFile(file) {
      if (!/\.(js|json|jsonl)$/i.test(file.name)) {
        U.toast('不支持的文件类型：<b>' + U.esc(file.name) + '</b>。请拖入 sanmou-viewer 导出的 .js / .json / .jsonl 文件。', 'err', 7000);
        return;
      }
      showBusy('正在读取 ' + U.esc(file.name) + ' …', '文件较大时会短暂无响应');
      const reader = new FileReader();
      reader.onload = function () {
        nextPaint(function () {
          try {
            const res = AC.sanmou.parseUploaded(String(reader.result), file.name);
            if (!res.ok) { U.toast(res.message, 'err', 8000); return; }
            const r = store.loadFromBattleData({ uploaded: true });
            store.saveUploaded(AC.battleData);   // 持久化：刷新后仍生效
            renderDataSource();
            clearSelection();
            recompute(true);
            store.save();
            const st = store.meta || {};
            U.toast('已载入上传数据 <b>' + r.count + '</b> 场战报'
              + (st.blocks ? '（完整交战 ' + st.blocks + ' 场）' : '')
              + '，刷新后仍生效。', 'ok', 6000);
          } catch (e) {
            U.toast('载入上传文件失败：' + e.message, 'err', 8000);
          } finally {
            hideBusy();
          }
        });
      };
      reader.onerror = function () {
        hideBusy();
        U.toast('读取文件失败。', 'err');
      };
      reader.readAsText(file, 'utf-8');
    }

    const uploadZone = $('#uploadZone');
    const uploadInput = $('#uploadInput');
    if (uploadZone && uploadInput) {
      uploadZone.addEventListener('click', function () { uploadInput.click(); });
      uploadInput.addEventListener('change', function (ev) {
        if (ev.target.files && ev.target.files.length) handleUploadedFile(ev.target.files[0]);
        ev.target.value = '';
      });
      // 拖拽高亮
      ['dragenter', 'dragover'].forEach(function (t) {
        uploadZone.addEventListener(t, function (ev) {
          ev.preventDefault();
          uploadZone.classList.add('over');
        });
      });
      ['dragleave', 'drop'].forEach(function (t) {
        uploadZone.addEventListener(t, function (ev) {
          ev.preventDefault();
          uploadZone.classList.remove('over');
        });
      });
      uploadZone.addEventListener('drop', function (ev) {
        ev.stopPropagation();
        if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
          handleUploadedFile(ev.dataTransfer.files[0]);
        }
      });
    }

    // 全局拖拽也接住（不用精确瞄准小框）
    window.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    window.addEventListener('drop', function (ev) {
      ev.preventDefault();
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
        handleUploadedFile(ev.dataTransfer.files[0]);
      }
    });

    // 移除上传数据：回到内置数据文件
    const btnClearUp = $('#btnClearUpload');
    if (btnClearUp) {
      btnClearUp.addEventListener('click', function () {
        if (!window.confirm('移除上传的数据，回到内置数据文件？')) return;
        Promise.resolve(store.clearUploaded()).then(function () {
          // 关键：上传时 parseUploaded 会覆盖 AC.battleData，
          // 必须先把内置数据还原回去，否则"回到内置"还是载到上传那份。
          const builtin = window.__builtinBattleData;
          if (builtin) {
            AC.battleData = builtin;
            showBusy('正在载入内置数据…', '');
            nextPaint(function () {
              try {
                const res = store.loadFromBattleData();
                renderDataSource();
                clearSelection();
                recompute(true);
                store.save();
                U.toast('已回到内置数据：<b>' + res.count + '</b> 场战报。', 'ok', 4200);
              } catch (e) {
                U.toast('载入失败：' + e.message, 'err', 6000);
              } finally {
                hideBusy();
              }
            });
          } else {
            // 页面本身没有内置数据文件
            delete AC.battleData;
            store.clear();
            store.clearUploaded();
            renderDataSource();
            clearSelection();
            recompute(true);
            U.toast('已移除上传数据。当前没有内置数据文件。', '', 5200);
          }
        });
      });
    }

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
    bindCheck('#onlyForceParity', 'onlyForceParity');
    bindRange('#forceGap', '#forceGapVal', 'forceParityGap', function (v) { return fmtGap(v); });
    linkDisable('#onlyForceParity', ['#forceGap']);
    bindCheck('#excludeMirror', 'excludeMirror');
    bindCheck('#excludeDraw', 'excludeDraw');
    bindCheck('#onlyRedParity', 'onlyRedParity');
    bindCheck('#onlyPinParity', 'onlyPinParity');
    bindRange('#redGap', '#redGapVal', 'redParityGap', function (v) { return fmtGap(v); });
    linkDisable('#onlyRedParity', ['#redGap']);
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
        onlyForceParity: true, forceParityGap: 3000,
        onlyRedParity: true, redParityGap: 1, minRedAvg: 0, onlyPinParity: false,
        redTier: 'all', pinTier: 'all'
      });
      syncControls();
      recompute();
    });

    $('#btnRelayout').addEventListener('click', function () { graph.relayout(); });

    $('#btnExportPng').addEventListener('click', exportPng);
    $('#btnReloadDataTop').addEventListener('click', function () {
      const b = $('#btnReloadData');
      if (b) b.click();
    });

    $('#btnClearAll').addEventListener('click', function () {
      if (!store.battles.length) { U.toast('当前没有数据。'); return; }
      if (!window.confirm('确定清空当前载入的数据？刷新页面后可重新从数据文件载入。')) return;
      Promise.resolve(store.clear()).then(function () {
        renderDataSource();
        clearSelection();
        recompute(true);
        U.toast('已清空数据。');
      });
    });

    // 视图切换
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.view); });
    });

    window.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      clearSelection();
    });
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

  /** 差值滑块的显示：-1 = 不限 */
  function fmtGap(v, suffix) {
    return Number(v) < 0 ? '不限' : U.fmtInt(v) + (suffix || '');
  }

  /** 开关未勾选时，把它的参数滑块置灰——表明该参数当前不生效 */
  function linkDisable(checkSel, rangeSels) {
    const box = $(checkSel);
    const list = rangeSels.map(function (s) { return $(s); }).filter(Boolean);
    const sync = function () {
      list.forEach(function (r) {
        r.disabled = !box.checked;
        const f = r.closest('.field');
        if (f) f.classList.toggle('is-off', !box.checked);
      });
    };
    box.__syncDisable = sync;
    box.addEventListener('change', sync);
    sync();
  }

  function syncControls() {
    $('#minPair').value = filters.minPair; $('#minPairVal').textContent = filters.minPair;
    $('#minAppear').value = filters.minAppear; $('#minAppearVal').textContent = filters.minAppear;
    $('#minLevel').value = filters.minLevel; $('#minLevelVal').textContent = filters.minLevel;
    $('#topN').value = filters.topN; $('#topNVal').textContent = filters.topN;
    $('#onlyFull').checked = filters.onlyFull;
    $('#onlyForceParity').checked = filters.onlyForceParity;
    $('#forceGap').value = filters.forceParityGap;
    $('#forceGapVal').textContent = fmtGap(filters.forceParityGap);
    $('#excludeMirror').checked = filters.excludeMirror;
    $('#excludeDraw').checked = filters.excludeDraw;
    $('#onlyStrong').checked = filters.strongOnly;
    $('#onlyRedParity').checked = filters.onlyRedParity;
    $('#onlyPinParity').checked = filters.onlyPinParity;
    $('#redGap').value = filters.redParityGap; $('#redGapVal').textContent = fmtGap(filters.redParityGap);
    $('#minRedAvg').value = filters.minRedAvg; $('#minRedAvgVal').textContent = filters.minRedAvg;
    $$('#redTierSeg .seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tier === filters.redTier); });
    $$('#pinTierSeg .seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tier === filters.pinTier); });
    $$('#dimSeg .seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.dim === filters.dimension); });
    // 复位后同步「开关关闭 → 参数滑块置灰」的状态
    ['#onlyForceParity', '#onlyRedParity'].forEach(function (sel) {
      const box = $(sel);
      if (box && box.__syncDisable) box.__syncDisable();
    });
  }

  const recomputeDebounced = U.debounce(function () { recompute(); }, 200);

  /* ================= 数据源 ================= */

  /** 把当前数据源状态渲染到侧边栏 */
  function renderDataSource() {
    const box = $('#dataSource');
    if (!box) return;

    const diag = AC.sanmou.diagnose();
    const counts = store.counts();
    const meta = store.meta || {};

    if (!diag.ok) {
      box.innerHTML = U.el('div', { class: 'src-empty' }, [
        U.el('strong', { text: '尚未载入数据' }),
        U.el('p', { text: diag.message })
      ]).innerHTML;
      return;
    }

    const rows = [
      ['战报记录', counts.total + ' 场'],
      ['完整交战', counts.block + ' 场'],
      ['续战段', counts.child + ' 场（不计入统计）']
    ];
    if (meta.players) rows.push(['玩家', meta.players + ' 人']);
    if (meta.heroes) rows.push(['武将记录', U.fmtNum ? U.fmtNum(meta.heroes) : meta.heroes + ' 条']);
    if (meta.earliest) rows.push(['时间范围', meta.earliest.slice(0, 10) + ' ~ ' + (meta.latest || '').slice(0, 10)]);
    if (meta.source) rows.push(['数据来源', String(meta.source).slice(0, 40)]);
    if (meta.generatedAt) rows.push(['导出时间', String(meta.generatedAt).replace('T', ' ').slice(0, 19)]);

    box.innerHTML = '';
    const tbl = U.el('div', { class: 'src-stats' });
    rows.forEach(function (pair) {
      tbl.appendChild(U.el('div', { class: 'src-row' }, [
        U.el('span', { class: 'k', text: pair[0] }),
        U.el('span', { class: 'v', text: pair[1] })
      ]));
    });
    box.appendChild(tbl);

    // 来源标签：上传的数据与内置文件区分显示
    const btnClearUp = $('#btnClearUpload');
    if (btnClearUp) btnClearUp.hidden = !store.hasUploaded;
    if (store.hasUploaded) {
      box.appendChild(U.el('p', {
        class: 'hint',
        text: '当前使用上传的数据文件（优先于内置）。点「移除上传」可回到内置数据。'
      }));
    }

    if (counts.child > 0) {
      box.appendChild(U.el('p', {
        class: 'hint',
        text: '续战段（child）是同一场交战的中间过程，只用于明细展示与连赢判定，不重复计入统计。'
      }));
    }
  }

  /* ================= 重算与刷新 ================= */

  function recompute(withAnim) {
    state.result = AC.analyzer.analyze(store.battles, filters);
    recCache = null;   // 数据变了，推荐配置的聚合缓存作废

    const r = state.result;
    $('#graphEmpty').style.display = r.stats.totalKept ? 'none' : 'flex';

    graph.setData(r, { topN: filters.topN });
    matrix.setData(r, { topN: filters.topN });
    rank.render(r);
    if (allianceView) allianceView.render(r);
    if (heroesView) heroesView.render(r);
    // 内战分析不跟着主分析的过滤走，直接吃原始战报
    if (mirrorView) mirrorView.render(store.battles);
    if (gearView) gearView.render(store.battles);
    if (playerView) playerView.render(r, store.battles);
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
    // 图例要短：它挤在标签栏右侧，长文案会被裁掉，完整口径放到悬浮提示里
    const breadthHint = '<span class="legend-item legend-extra" title="3D 视图的节点高度 = 强度分（公平压制力 + 打赢面）">3D 高度 = 强度分</span>';
    $('#legend').innerHTML = filters.dimension === 'comp'
      ? '<span class="legend-item"><span class="legend-bar"></span>被克 &rarr; 均衡 &rarr; 克</span>' +
        '<span class="legend-item legend-extra">节点大小 = 出场次数</span>' +
        '<span class="legend-item legend-extra">流动方向 = 克制方向</span>' +
        breadthHint
      : '<span class="legend-item"><span class="legend-bar"></span>被克 &rarr; 均衡 &rarr; 克</span>' +
        '<span class="legend-item legend-extra">节点大小 = 出场次数</span>' +
        breadthHint;
    updateFoot();
  }

  function updateStats(r, withAnim) {
    const s = r.stats;
    const counts = store.counts();
    setNum('#statBattles', s.totalKept, withAnim);
    setNum('#statNodes', s.nodeShown, withAnim);
    setNum('#statEdges', s.edgeCount, withAnim);
    setNum('#statPairs', s.pairCount, withAnim);
    const statTotal = $('#statTotal');
    if (statTotal) setNum('#statTotal', counts.total, withAnim);

    const sum = $('#dataSummary');
    if (!counts.total) {
      sum.textContent = '尚未载入数据';
    } else {
      let t = '共 ' + counts.total + ' 条记录（完整交战 ' + counts.block
            + ' · 续战段 ' + counts.child + '）';
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
    if (s.chainedMerged) parts.push('打平续战合并 ' + s.chainedMerged + ' 次');
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
    // 切换选中阵容后详情面板从头看
    U.scrollTopAll($('#inspector'));
  }

  /* 阵容推荐配置：从同盟画像里收集这套阵容被用过的全部配置（懒聚合 + 随数据失效） */
  let recCache = null;

  function recommendedConfigs(node) {
    if (!AC.allianceAnalysis || !AC.allianceAnalysis.build) return [];
    if (!recCache) recCache = AC.allianceAnalysis.build(state.result) || [];

    const map = new Map();
    recCache.forEach(function (ally) {
      (ally.playerList || []).forEach(function (p) {
        (p.comps || []).forEach(function (pc) {
          if (pc.key !== node.key) return;
          (pc.configList || []).forEach(function (cfg) {
            let e = map.get(cfg.sig);
            if (!e) {
              e = {
                sig: cfg.sig, heroes: cfg.heroes, formation: cfg.formation,
                troopSig: cfg.troopSig || node.troopSig, n: 0, win: 0, draw: 0, lastTs: 0
              };
              map.set(cfg.sig, e);
            }
            e.n += cfg.n; e.win += cfg.win; e.draw += cfg.draw;
            if (cfg.lastTs && cfg.lastTs > e.lastTs) e.lastTs = cfg.lastTs;
          });
        });
      });
    });

    return Array.from(map.values()).map(function (c) {
      c.rate = (c.win + c.draw * 0.5) / (c.n || 1);
      const reds = (c.heroes || []).map(function (h) { return h.red; })
        .filter(function (v) { return v !== null && v !== undefined; });
      c.redAvg = reds.length ? reds.reduce(function (a, b) { return a + b; }, 0) / reds.length : null;
      return c;
    }).sort(function (a, b) { return b.n - a.n || b.rate - a.rate; });
  }

  /**
   * 连赢战报：点开看这一波的逐场战绩（谁打的、打了谁、武勋多少、有没有被当前筛选排除）。
   * 复用玩家分析的战报浮层，只是把「该玩家 + 该阵容」的交战记录列出来——
   * run.ids 是这段连赢的战斗编号，用于提示这次要看的是哪几场。
   */
  function openStreakLog(node, run) {
    if (!run || !run.ids || !run.ids.length) {
      U.toast('这段连赢没有可展示的战报（旧版导出可能缺战斗编号）。', 'warn');
      return;
    }
    const r = state.result;
    if (!AC.playerAnalysis || !AC.playerAnalysis.openBattleLog) {
      U.toast('战报浮层不可用。', 'err');
      return;
    }
    const keptSet = new Set((r && r.battles ? r.battles : []).map(function (b) { return b.id; }));
    AC.playerAnalysis.openBattleLog({
      result: r,
      allBattles: (r && r.allBattles) ? r.allBattles : (r ? r.battles : []),
      keptIdSet: keptSet,
      playerName: run.player,
      comp: node,
      // 只列这一段连赢期间的交战（含被筛选排除的场次，卡片上会打标）
      range: { from: run.startTs || 0, to: run.endTs || 0 },
      note: '连赢 ' + run.len + ' 场 · 平均武勋 ' + Math.round(run.wuxunAvg || 0) + '/场'
    });
  }

  function openRecommendedConfig(node) {
    const all = recommendedConfigs(node);
    const SHOW = 20;                       // 变体可能上百套，只渲染排序后的前若干套
    const label = { n: '使用场次', rate: '胜率' };
    AC.openConfigList(
      node.display + ' · 推荐配置',
      function (key, shown) {
        return '共 ' + all.length + ' 套 · 按' + (label[key] || '场次') + '排序'
          + (all.length > SHOW ? '，显示前 ' + SHOW + ' 套' : '');
      },
      all.slice(0, SHOW),
      {
        defaultSort: 'n',
        sorts: [
          { key: 'n', label: '按场次', tip: '最主流、最多人用的配置排在前面' },
          { key: 'rate', label: '按胜率', tip: '胜率最高的配置排在前面（小样本已做收缩保护，避免 1 场 100% 霸榜）' }
        ]
      }
    );
  }

  function renderNodeInspector(node) {
    const r = state.result;
    const insp = $('#inspector');
    insp.innerHTML = '';

    insp.appendChild(U.el('div', { class: 'insp-head' }, [
      U.el('div', { class: 'insp-kicker', text: filters.dimension === 'comp' ? '阵容详情' : '阵型详情' }),
      U.el('h2', { class: 'insp-title' }, [U.compWithTroop(node.display, node.troopSig)])
    ]));

    // 推荐配置：汇总这套阵容被用过的全部配置，按使用场次排序（照着抄即可）
    if (filters.dimension === 'comp' && AC.openConfigList) {
      insp.appendChild(U.el('div', { class: 'insp-actions' }, [
        U.el('button', {
          class: 'insp-btn', text: '推荐配置',
          title: '看看这套阵容大家都怎么配（技能 / 兵书 / 装备 / 战马 / 阵型），按使用场次排序',
          onclick: function () { openRecommendedConfig(node); }
        }),
        U.el('span', { class: 'insp-btn-tip', text: '汇总所有玩家用过的配置，按使用场次排序' })
      ]));
    }

    insp.appendChild(U.el('div', { class: 'insp-grid' }, [
      cell('强度分', (node.strength || 0).toFixed(1) + ' / 100'),
      cell('出场', node.n + ' 场'),
      cell('胜率', U.fmtPct(node.rate, 1)),
      cell('战绩', node.win + '胜 ' + node.loss + '负 ' + node.draw + '平'),
      cell('公平胜率', node.nFair > 0 ? U.fmtPct(node.rateFair, 1) + '（' + node.nFair + ' 场）' : '无公平样本'),
      cell('赢过队伍', (node.beatKinds || 0) + ' / 交过手 ' + (node.oppTypes || 0) + ' 支'),
      cell('连胜', '最高 ' + (node.streakBest || 0) + ' 连 · 3 连以上 ' + (node.streakStrong || 0) + ' 次'),
      cell('赢时战损', node.fairLoss === null || node.fairLoss === undefined ? '-' : U.fmtPct(node.fairLoss, 1) + '（我方掉兵占双方）')
    ]));

    // 五维分项：强度分是怎么来的，逐项摊开给玩家看
    const PARTS = [
      { key: 'sSpan', label: '打击面', w: '32%', desc: '赢过多少支不同队伍' },
      { key: 'sWin', label: '胜率', w: '26%', desc: '只认均势与以少打多的公平胜率' },
      { key: 'sStreak', label: '连胜', w: '15%', desc: '这套阵容打出的最高连赢' },
      { key: 'sLoss', label: '战损', w: '12%', desc: '赢的时候掉兵省不省' },
      { key: 'sDis', label: '劣势', w: '12%', desc: '以少打多能不能赢' }
    ];
    insp.appendChild(U.el('div', { class: 'force-split' }, [
      U.el('div', { class: 'fs-title', text: '强度分拆解（满分 100）' }),
      U.el('div', { class: 'score-parts' }, PARTS.map(function (d) {
        const v = Math.max(0, Math.min(100, node[d.key] || 0));
        return U.el('div', { class: 'sp-row' }, [
          U.el('span', { class: 'sp-name', text: d.label + '（' + d.w + '）' }),
          U.el('span', { class: 'sp-bar' }, [
            U.el('i', { style: { width: v + '%', background: v >= 70 ? '#ff7a5c' : (v >= 45 ? '#ffb347' : '#3ad2ff') } })
          ]),
          U.el('span', { class: 'sp-num', text: v.toFixed(0) }),
          U.el('span', { class: 'sp-desc', text: d.desc })
        ]);
      }))
    ]));

    // 兵力态势拆解：压制力只看「势均力敌」与「以少打多」，靠兵力优势刷出来的不算强度
    // （打赢面单独成块，见下）
    if (node.byForce && (node.nEven > 0 || node.nDis > 0 || node.nAdv > 0)) {
      const fsRow = function (label, fb, rate, counts) {
        return U.el('div', { class: 'fs-row' + (counts ? '' : ' muted') }, [
          U.el('span', { class: 'fs-k', text: label }),
          U.el('span', { class: 'fs-n', text: fb.n + ' 场' }),
          U.el('span', {
            class: 'fs-v',
            style: { color: rate === null ? '#5d6f8f' : U.rateColor(rate) },
            text: rate === null ? '-' : U.fmtPct(rate, 1)
          }),
          counts ? U.el('span', { class: 'fs-tag', text: '计入强度' }) : U.el('span', { class: 'fs-tag off', text: '不计入' })
        ]);
      };
      insp.appendChild(U.el('div', { class: 'force-split' }, [
        U.el('div', { class: 'fs-title', text: '兵力态势拆解' }),
        fsRow('势均力敌', node.byForce.even, node.rateEven, true),
        fsRow('以少打多', node.byForce.dis, node.rateDis, true),
        fsRow('以多打少', node.byForce.adv, node.rateAdv, false),
        U.el('div', { class: 'fs-note' }, [
          U.el('span', { text: '公平压制力（均势+劣势）' }),
          U.el('b', { style: { color: U.rateColor(0.5 + node.netPowerFair) }, text: U.fmtSigned(node.netPowerFair, 1) }),
          U.el('span', { style: { color: '#5d6f8f' }, text: '　旧口径（含以多打少）' }),
          U.el('span', { style: { color: '#8fa3c4' }, text: U.fmtSigned(node.netPower, 1) })
        ])
      ]));
    }

    // 连胜：一次出战 = 用剩余兵力接着打，直到输／平／接不上（兵力衔接判定，不看时间间隔）
    // 指标取「这套阵容打出的最高连赢」——最能说明「这波推过去能连吃几支队伍」
    const bestRun = node.streakBestRun || null;
    insp.appendChild(U.el('div', { class: 'force-split' }, [
      U.el('div', { class: 'fs-title', text: '连胜（这套阵容打出的最高连赢）' }),
      U.el('div', { class: 'fs-note' }, [
        U.el('span', { text: '最高连赢' }),
        U.el('b', { style: { color: U.rateColor(0.5 + Math.min(0.5, (node.streakBest || 0) / 10)) }, text: (node.streakBest || 0) + ' 场' }),
        U.el('span', { style: { color: '#5d6f8f' }, text: '　某玩家用这套阵容一次出战连续打赢的最多场数' +
          (node.streakBestAll && node.streakBestAll > (node.streakBest || 0) ? '（含被筛选排除的场次则达 ' + node.streakBestAll + ' 场）' : '') })
      ]),
      U.el('div', { class: 'fs-note' }, [
        U.el('span', { text: '3 连以上' }),
        U.el('b', { style: { color: '#8fa3c4' }, text: (node.streakStrong || 0) + ' 次' }),
        U.el('span', { style: { color: '#5d6f8f' }, text: '　打出过的次数：经常能连赢，还是偶然一次' })
      ]),
      // 连赢的「含金量」：武勋几千几百 = 打的是残兵/低等级，体现不出强度
      U.el('div', { class: 'fs-note' }, [
        U.el('span', { text: '连赢成色' }),
        U.el('b', {
          style: { color: node.streakWuxunAvg >= 3800 ? '#ff7a5c' : (node.streakWuxunAvg >= 3000 ? '#ffb347' : '#8fa3c4') },
          text: node.streakWuxunAvg > 0 ? Math.round(node.streakWuxunAvg) + ' 武勋/场' : '无武勋列'
        }),
        U.el('span', { style: { color: '#5d6f8f' }, text: node.streakWuxunAvg > 0
          ? '　连赢段的平均单场武勋（' + (node.streakHighWuxun || 0) + ' 段达标）：几千几百说明打的是残兵/低等级'
          : '　旧版导出没有武勋列，未做含金量折算' })
      ]),
      // 连赢场数看着漂亮、成色却不够时，直接把话说清楚，别让玩家被数字骗
      (node.streakBest >= 2 && node.streakWuxunAvg > 0 && node.streakWuxunAvg < 3000)
        ? U.el('div', { class: 'fs-warn', text: '⚠ 这段连赢的成色偏低（平均 ' + Math.round(node.streakWuxunAvg) +
          ' 武勋/场）：多半打的是残兵或低等级队伍，强度参考价值有限' })
        : null,
      U.el('div', { class: 'fs-note' }, [
        U.el('span', { text: '判定口径　' }),
        U.el('span', { style: { color: '#8fa3c4' }, text: '下一场的开战兵力 ≈ 上一场的剩余兵力（1% 内）就算同一次出战（隔多久都算），直到输／平／再没有能接上的对手' })
      ]),
      // 连赢的证据：点开就是这一波的逐场战报（哪几场、对手是谁、武勋多少、是否被当前筛选排除）
      bestRun ? U.el('div', { class: 'streak-evidence' }, [
        U.el('button', {
          class: 'insp-btn', text: '查看连赢战报（' + bestRun.len + ' 连）',
          title: bestRun.player + ' 用这套阵容连赢 ' + bestRun.len + ' 场，点开看逐场战报',
          onclick: function () { openStreakLog(node, bestRun); }
        }),
        U.el('span', { class: 'insp-btn-tip', text: bestRun.player + ' · ' + bestRun.len + ' 连 · 累计武勋 ' + U.fmtInt(bestRun.wuxun) })
      ]) : null,
      (node.streakStrongRuns && node.streakStrongRuns.length) ? U.el('div', { class: 'streak-runs' }, [
        U.el('div', { class: 'fs-note' }, [
          U.el('span', { text: '打出过 ' + node.streakStrongRuns.length + ' 段 3 连以上：' }),
          U.el('span', { style: { color: '#5d6f8f' }, text: '点玩家名看该段战报' })
        ]),
        U.el('div', { class: 'streak-run-list' }, node.streakStrongRuns.slice(0, 8).map(function (r) {
          return U.el('div', { class: 'streak-run-row' }, [
            U.el('span', { class: 'run-player', text: r.player }),
            U.el('span', { class: 'run-len', text: r.len + ' 连' }),
            U.el('span', { class: 'run-wuxun', text: '武勋 ' + U.fmtInt(r.wuxun) + '（均 ' + Math.round(r.wuxunAvg) + '）' }),
            U.el('button', {
              class: 'insp-btn btn-xs', text: '战报',
              onclick: function () { openStreakLog(node, r); }
            })
          ]);
        }))
      ]) : null
    ]));

    // 战损与劣势：赢的时候省不省兵、少打多能不能赢
    insp.appendChild(U.el('div', { class: 'force-split' }, [
      U.el('div', { class: 'fs-title', text: '战损与劣势' }),
      U.el('div', { class: 'fs-note' }, [
        U.el('span', { text: '赢时战损' }),
        U.el('b', { style: { color: '#8fa3c4' }, text: node.fairLoss === null || node.fairLoss === undefined ? '-' : U.fmtPct(node.fairLoss, 1) }),
        U.el('span', { style: { color: '#5d6f8f' }, text: '　我方掉兵 / 双方掉兵（只算赢的公平场次，' + (node.lossN || 0) + ' 场）' })
      ]),
      U.el('div', { class: 'fs-note' }, [
        U.el('span', { text: '场均战损' }),
        U.el('b', { style: { color: '#8fa3c4' }, text: U.fmtShort(node.avgCostOut) }),
        U.el('span', { style: { color: '#5d6f8f' }, text: '　战损比（对方掉兵/我方掉兵）' + (node.exchange === null ? '-' : node.exchange.toFixed(2)) })
      ]),
      U.el('div', { class: 'fs-note' }, [
        U.el('span', { text: '以少打多' }),
        U.el('b', {
          style: { color: node.rateDis === null ? '#8fa3c4' : U.rateColor(node.rateDis) },
          text: node.rateDis === null ? '无样本（打开「只统计兵力接近」时为 0）' : (node.nDis + ' 场 · 胜率 ' + U.fmtPct(node.rateDis, 0))
        }),
        node.disLift === null || node.disLift === undefined ? null
          : U.el('span', { style: { color: '#5d6f8f' }, text: '　比自己的公平胜率' + (node.disLift >= 0 ? '高 ' : '低 ') + U.fmtPct(Math.abs(node.disLift), 1) })
      ])
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
    const LIMIT = 5;
    const allKeys = Object.keys(obj);
    // 与「克制的对手」保持一致：条数超过显示上限时，标题里说明总共有多少
    const head = allKeys.length > LIMIT
      ? title + '（共 ' + allKeys.length + '，显示前 ' + LIMIT + '）'
      : title + '（共 ' + allKeys.length + '）';
    const entries = allKeys.map(function (k) { return { k: k, v: obj[k] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, LIMIT);
    const sec = U.el('div', { class: 'insp-section' }, [U.el('h4', { text: head })]);
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
    const LIMIT = 12;
    const shown = list.slice(0, LIMIT);
    // 标题写清总数与当前显示条数，避免「（50）却只看到十几个」的疑惑
    const head = list.length > LIMIT
      ? title + '（共 ' + list.length + '，显示前 ' + LIMIT + '）'
      : title + '（共 ' + list.length + '）';
    const sec = U.el('div', { class: 'insp-section' }, [U.el('h4', { text: head })]);
    if (!list.length) {
      sec.appendChild(U.el('div', { class: 'hint', text: '暂无显著样本' }));
      return sec;
    }

    const body = U.el('div', { class: 'vs-body' });
    let expanded = false;

    function renderRows(rows) {
      body.innerHTML = '';
      rows.forEach(function (m) {
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
        body.appendChild(row);
      });
    }
    renderRows(shown);
    sec.appendChild(body);

    if (list.length > LIMIT) {
      const btn = U.el('button', { class: 'vs-more' });
      const setLabel = function () {
        btn.textContent = expanded ? '收起（只看前 ' + LIMIT + ' 个）' : '展开全部 ' + list.length + ' 个';
      };
      setLabel();
      btn.addEventListener('click', function () {
        expanded = !expanded;
        renderRows(expanded ? list : shown);
        setLabel();
      });
      sec.appendChild(btn);
    }
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
        U.el('div', {}, [U.compWithTroop(nameB, B ? B.troopSig : '')])      ])
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
      cell('战损优势', p.lossGap === null ? '-' : U.fmtSigned(p.lossGap, 1)),
        cell('平均开战兵力', U.fmtShort(p.avgOriginLo || 0) + ' / ' + U.fmtShort(p.avgOriginHi || 0)),
        cell('兵力对比', (p.avgOriginHi ? (p.avgOriginLo / p.avgOriginHi).toFixed(2) + ' : 1' : '-'))
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

    // 切换对阵后详情面板从头看
    U.scrollTopAll(insp);
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
      U.el('div', { class: 'bm-force' }, [
        U.el('span', { class: 'bm-force-k', text: '开战兵力' }),
        U.el('span', { class: 'bm-force-v', text: '攻 ' + U.fmtInt(b.atk.origin) + ' → ' + U.fmtInt(b.atk.remain) + lossTag(b.atk) }),
        U.el('span', { class: 'bm-force-v', text: '守 ' + U.fmtInt(b.def.origin) + ' → ' + U.fmtInt(b.def.remain) + lossTag(b.def) })
      ]),
      U.el('div', { class: 'bm-meta', text: '伤/亡  攻 ' + U.fmtInt(b.atk.wounded) + '/' + U.fmtInt(b.atk.dead) + '   守 ' + U.fmtInt(b.def.wounded) + '/' + U.fmtInt(b.def.dead) }),
      (b.atk.redDist || b.atk.pinDist) ? U.el('div', { class: 'bm-meta', text: '红度/品级  攻 ' + rp(b.atk) + '   守 ' + rp(b.def) }) : null
    ]);
    return node;
  }

  /** 损失率标签，如「（-39%）」；没有开战兵力时返回空串 */
  function lossTag(side) {
    if (!side.origin) return '';
    const loss = side.origin - (side.remain || 0);
    const pct = loss / side.origin;
    return '（' + (pct >= 0 ? '-' : '+') + (pct * 100).toFixed(0) + '%）';
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
        '<br>强度分 ' + (nd.strength || 0).toFixed(1) + ' / 100 · 出场 ' + nd.n + ' 场 · 胜率 ' + U.fmtPct(nd.rate) +
        '<br>打击面 ' + (nd.sSpan || 0).toFixed(0) + ' · 胜率 ' + (nd.sWin || 0).toFixed(0) +
        ' · 连胜 ' + (nd.sStreak || 0).toFixed(0) + ' · 战损 ' + (nd.sLoss || 0).toFixed(0) + ' · 劣势 ' + (nd.sDis || 0).toFixed(0) +
        '<br>赢过 ' + (nd.beatKinds || 0) + ' / 交过手 ' + (nd.oppTypes || 0) + ' 支队伍' +
        ' · 最长 ' + (nd.streakMax || 0) + ' 连赢' +
        (nd.fairLoss === null || nd.fairLoss === undefined ? '' : ' · 赢时战损 ' + U.fmtPct(nd.fairLoss, 0)) +
        (nd.nDis >= 3 && nd.rateDis !== null ? ' · 以少打多 ' + U.fmtPct(nd.rateDis, 0) : '') +
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

  document.addEventListener('DOMContentLoaded', init);

  /* ================= 版本与缓存自检 ================= */

  /* 版本号来自 js/version.js（由 tools/bump-version.mjs 从 version.json 生成），
     不再手工维护：升级只改 version.json 后跑一次该脚本即可。 */
  const BUILD = (window.AC && window.AC.VERSION && window.AC.VERSION.version) || 'dev';

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
    recompute: recompute,
    renderDataSource: renderDataSource,
    switchView: switchView,
    selectNode: selectNode,
    showPair: showPair,
    clearSelection: clearSelection,
    graphRef: function () { return graph; },
    matrixRef: function () { return matrix; },
    allianceRef: function () { return allianceView; },
    heroesRef: function () { return heroesView; },
    mirrorRef: function () { return mirrorView; },
    gearRef: function () { return gearView; },
    playerRef: function () { return playerView; },
    build: BUILD
  };

  // 「检查更新」按钮（js/update.js）
  if (AC.updateInit) {
    document.addEventListener('DOMContentLoaded', AC.updateInit);
  }
})(window.AC);
