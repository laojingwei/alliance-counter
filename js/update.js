/* ============================================================
   检查更新
   ------------------------------------------------------------
   浏览器不允许网页替换本地文件，所以这里做的是：
     1) 拉取仓库里的 version.json，和本地版本对比；
     2) 有新版 -> 显示更新内容 + 一键下载 + 更新步骤；
     3) 没网/未配置仓库 -> 如实说明，并给出手动检查入口。

   仓库地址在 index.html 的 <body data-repo="..."> 上配置。
   ============================================================ */
window.AC = window.AC || {};

(function (AC) {
  'use strict';

  const U = AC.util;

  /** 本地版本：与 app.js 里的 BUILD、index.html 里的 ?v= 保持一致 */
  function localVersion() {
    return (AC.app && AC.app.build) || 'unknown';
  }

  /** 仓库地址：来自 <body data-repo="https://github.com/用户/仓库"> */
  function repoUrl() {
    const raw = (document.body && document.body.dataset && document.body.dataset.repo) || '';
    return String(raw).trim().replace(/\/+$/, '');
  }

  /** 由仓库地址推导出 version.json 的候选地址 */
  function versionUrls() {
    const repo = repoUrl();
    const out = [];
    // 还没填仓库地址时不要傻等 GitHub，直接看同目录
    const unconfigured = !repo || /YOUR-NAME|你的用户名/i.test(repo);
    const m = unconfigured ? null : /^https?:\/\/github\.com\/([^\/]+)\/([^\/?#]+)/i.exec(repo);

    if (m) {
      const user = m[1], name = m[2].replace(/\.git$/, '');
      out.push('https://raw.githubusercontent.com/' + user + '/' + name + '/main/version.json');
      out.push('https://raw.githubusercontent.com/' + user + '/' + name + '/master/version.json');
    } else if (!unconfigured) {
      // 非 GitHub：假设仓库根目录可直接访问
      out.push(repo + '/version.json');
      out.push(repo + '/raw/main/version.json');
    }
    // 部署在 Pages / 本地服务器时，同目录也放了一份
    out.push('version.json');
    return out;
  }

  /** 依次尝试候选地址（Promise 链，保持与项目其它部分一致的兼容写法） */
  function fetchRemoteVersion() {
    const urls = versionUrls();
    let lastErr = null;

    function tryNext(i) {
      if (i >= urls.length) return Promise.reject(lastErr || new Error('没有可用的检查地址'));
      return fetch(urls[i], { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.version) throw new Error('version.json 格式不对');
          data._from = urls[i];
          return data;
        })
        .catch(function (err) {
          lastErr = err;
          return tryNext(i + 1);
        });
    }
    return tryNext(0);
  }

  function cmpVersion(a, b) {
    // 版本号形如 20261011f：先比前面的数字，再比末尾字母
    const pa = /^(\d*)([a-z]*)$/i.exec(String(a).trim());
    const pb = /^(\d*)([a-z]*)$/i.exec(String(b).trim());
    if (!pa || !pb) return String(a) === String(b) ? 0 : 1;
    if (Number(pa[1]) !== Number(pb[1])) return Number(pa[1]) > Number(pb[1]) ? 1 : -1;
    const la = (pa[2] || '').toLowerCase(), lb = (pb[2] || '').toLowerCase();
    if (la === lb) return 0;
    return la > lb ? 1 : -1;
  }

  /* ---------------- 界面 ---------------- */

  function panel() { return U.$('#updatePanel'); }

  function showPanel(html) {
    const p = panel();
    if (!p) return;
    p.innerHTML = html;
    p.classList.add('show');
  }

  function hidePanel() {
    const p = panel();
    if (p) p.classList.remove('show');
  }

  function renderChecking() {
    showPanel('<div class="up-title">正在检查更新…</div><div class="up-sub">连接仓库读取版本信息</div>');
  }

  function renderResult(local, remote) {
    const cmp = remote ? cmpVersion(remote.version, local) : 0;
    const repo = repoUrl();
    const link = repo || (remote && remote._from) || '';

    if (remote && cmp > 0) {
      showPanel([
        '<div class="up-title up-new">发现新版本 <b>v' + U.esc(remote.version) + '</b></div>',
        '<div class="up-sub">当前 v' + U.esc(local) + ' · 发布于 ' + U.esc(remote.releasedAt || '-') + '</div>',
        remote.name ? '<div class="up-name">' + U.esc(remote.name) + '</div>' : '',
        (remote.notes && remote.notes.length)
          ? '<ul class="up-notes">' + remote.notes.map(function (n) { return '<li>' + U.esc(n) + '</li>'; }).join('') + '</ul>'
          : '',
        '<div class="up-how">',
        '<b>怎么更新</b>：浏览器不能替换本地文件，请到<b>你放这个项目的目录</b>（就是含 <code>index.html</code> 的文件夹）下运行更新脚本：',
        '<div class="up-script"><span>Windows</span><code>update-windows.cmd</code><span>双击运行</span></div>',
        '<div class="up-script"><span>macOS</span><code>update-mac.command</code><span>双击运行</span></div>',
        '脚本会自动下载最新版并覆盖：<b>先整目录备份</b>，且保留 <code>samples/</code> 与你的仓库地址配置。',
        '更新完成后刷新本页（Ctrl+F5 / Cmd+Shift+R）即可。</div>',
        link ? '<div class="up-actions" style="margin-top:10px"><a class="up-btn" href="' + U.esc(link) + '" target="_blank" rel="noopener">打开仓库</a></div>' : ''
      ].join(''));
    } else if (remote) {
      showPanel([
        '<div class="up-title up-ok">已是最新版本 <b>v' + U.esc(local) + '</b></div>',
        '<div class="up-sub">发布于 ' + U.esc(remote.releasedAt || '-') + ' · 检查时间 ' + new Date().toLocaleTimeString() + '</div>',
        remote.notes && remote.notes.length
          ? '<ul class="up-notes">' + remote.notes.map(function (n) { return '<li>' + U.esc(n) + '</li>'; }).join('') + '</ul>'
          : ''
      ].join(''));
    }
  }

  function renderError(err, local) {
    const repo = repoUrl();
    showPanel([
      '<div class="up-title up-warn">检查失败</div>',
      '<div class="up-sub">' + U.esc(err && err.message ? err.message : String(err)) + '</div>',
      '<div class="up-how">',
      '常见原因：<br>',
      '· 还没配置仓库地址 → 在 <code>index.html</code> 的 <code>&lt;body data-repo="你的仓库地址"&gt;</code> 填上；<br>',
      '· 没联网，或所在网络访问 GitHub 受限；<br>',
      '· 用 <code>file://</code> 直接打开时部分浏览器会拦截跨域请求。',
      '</div>',
      repo ? '<div class="up-actions"><a class="up-btn" href="' + U.esc(repo) + '" target="_blank" rel="noopener">手动打开仓库看看</a></div>' : '',
      '<div class="up-sub" style="margin-top:8px">当前本地版本 v' + U.esc(local) + '</div>'
    ].join(''));
  }

  /* ---------------- 对外 ---------------- */

  function checkUpdate() {
    const local = localVersion();
    renderChecking();
    fetchRemoteVersion()
      .then(function (remote) { renderResult(local, remote); })
      .catch(function (err) { renderError(err, local); });
  }

  /** 启动时静默检查一次：只在发现新版时给按钮加个红点，不打扰 */
  function silentCheck() {
    const local = localVersion();
    fetchRemoteVersion()
      .then(function (remote) {
        if (remote && cmpVersion(remote.version, local) > 0) {
          const btn = U.$('#btnCheckUpdate');
          if (btn) {
            btn.classList.add('has-new');
            btn.title = '发现新版本 v' + remote.version + '，点击查看';
          }
        }
      })
      .catch(function () { /* 静默失败，不打扰 */ });
  }

  function init() {
    const btn = U.$('#btnCheckUpdate');
    if (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        btn.classList.remove('has-new');
        if (panel() && panel().classList.contains('show')) hidePanel();
        else checkUpdate();
      });
    }
    // 点空白处收起
    document.addEventListener('click', function (ev) {
      const p = panel();
      if (!p || !p.classList.contains('show')) return;
      if (p.contains(ev.target)) return;
      if (ev.target === btn) return;
      hidePanel();
    });
    // 启动 2 秒后静默检查（避免和首屏渲染抢资源）
    setTimeout(silentCheck, 2000);
  }

  AC.update = {
    check: checkUpdate,
    silentCheck: silentCheck,
    localVersion: localVersion,
    repoUrl: repoUrl,
    cmpVersion: cmpVersion
  };
  AC.updateInit = init;
})(window.AC);
