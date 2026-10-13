window.AC = window.AC || {};

/* ============================================================
   数据仓库
   ------------------------------------------------------------
   数据源只有一个：sanmou-viewer 导出的 window.AC.battleData。
   它已经在导出时按 battleId 去重，所以这里不再做叠加去重。

   职责：
     - 装载 battleData -> 内部 battle 数组
     - 缓存到 IndexedDB（数据文件很大，避免每次重新转换）
     - 提供统计摘要
   ============================================================ */
(function (AC) {
  'use strict';

  /* 缓存版本：内部结构变化时 +1，旧缓存自动失效 */
  const VERSION = 4;
  const KEY = 'ac.battles.v' + VERSION;

  /* IndexedDB：数据量动辄几十 MB，localStorage 的 5MB 放不下。
     超时兜底：某些环境（隐私模式、其它标签页占库）既不成功也不失败，
     没有超时会让启动卡在加载遮罩上。 */
  const IDB_NAME = 'alliance-counter';
  const IDB_STORE = 'snapshot';
  const IDB_TIMEOUT = 3000;

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('indexedDB unavailable')); return; }
      let settled = false;
      const settle = function (fn, arg) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(function () { settle(reject, new Error('idb open timeout')); }, IDB_TIMEOUT);
      let req;
      try { req = window.indexedDB.open(IDB_NAME, 1); } catch (e) { settle(reject, e); return; }
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { settle(resolve, req.result); };
      req.onerror = function () { settle(reject, req.error || new Error('idb open failed')); };
      req.onblocked = function () { settle(reject, new Error('idb blocked')); };
    });
  }

  function idbPut(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        let settled = false;
        const settle = function (fn, arg) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { db.close(); } catch (e) { /* ignore */ }
          fn(arg);
        };
        const timer = setTimeout(function () { settle(reject, new Error('idb put timeout')); }, IDB_TIMEOUT * 4);
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { settle(resolve, true); };
        tx.onerror = function () { settle(reject, tx.error); };
        tx.onabort = function () { settle(reject, tx.error || new Error('aborted')); };
      });
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        let settled = false;
        const settle = function (fn, arg) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { db.close(); } catch (e) { /* ignore */ }
          fn(arg);
        };
        const timer = setTimeout(function () { settle(reject, new Error('idb get timeout')); }, IDB_TIMEOUT);
        const tx = db.transaction(IDB_STORE, 'readonly');
        const r = tx.objectStore(IDB_STORE).get(key);
        r.onsuccess = function () { settle(resolve, r.result || null); };
        r.onerror = function () { settle(reject, r.error); };
      });
    });
  }

  function idbDel(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        let settled = false;
        const settle = function (arg) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { db.close(); } catch (e) { /* ignore */ }
          resolve(arg);
        };
        const timer = setTimeout(function () { settle(false); }, IDB_TIMEOUT);
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE)['delete'](key);
        tx.oncomplete = function () { settle(true); };
        tx.onerror = function () { settle(false); };
      });
    });
  }

  /** 清掉更早版本留下的缓存键（结构不同，留着只会误导） */
  function cleanLegacy() {
    let cleaned = 0;
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('ac.battles.v') === 0 && k !== KEY) {
          localStorage.removeItem(k);
          cleaned++;
        }
      });
    } catch (e) { /* ignore */ }
    return cleaned;
  }

  function Store() {
    this.battles = [];
    this.byId = new Map();
    this.meta = null;        // 数据文件的 stats（记录数、时间范围等）
    this.loadedAt = null;
    this.hasUploaded = false; // 当前数据是否来自用户上传
    cleanLegacy();
  }

  /** 装载一批 battle（数据源变化时重建索引） */
  Store.prototype.set = function (battles, meta, opts) {
    this.battles = battles;
    this.byId = new Map();
    for (let i = 0; i < battles.length; i++) this.byId.set(battles[i].id, battles[i]);
    this.meta = meta || null;
    this.loadedAt = Date.now();
    this.hasUploaded = !!(opts && opts.uploaded);
    return this;
  };

  /** 从 window.AC.battleData 转换并装载 */
  Store.prototype.loadFromBattleData = function (opts) {
    const diag = AC.sanmou.diagnose();
    if (!diag.ok) throw new Error(diag.message);
    const battles = AC.sanmou.toBattles();
    if (!battles.length) throw new Error('数据文件里没有可用的战报记录。');
    this.set(battles, AC.sanmou.summary(), opts);
    return { count: battles.length, meta: this.meta };
  };

  /** 用户上传的数据：保存原始 JSON 到 IndexedDB（刷新后自动恢复，优先于内置文件） */
  Store.prototype.UPLOAD_KEY = 'uploaded';
  Store.prototype.saveUploaded = function (data) {
    const payload = { version: VERSION, savedAt: Date.now(), data: data };
    return idbPut(KEY + '.' + this.UPLOAD_KEY, payload).then(function () { return true; })
      .catch(function () { return false; });
  };
  Store.prototype.loadUploaded = function () {
    return idbGet(KEY + '.' + this.UPLOAD_KEY).then(function (snap) {
      if (!snap || snap.version !== VERSION || !snap.data ||
          !Array.isArray(snap.data.records) || !snap.data.records.length) {
        return { ok: false };
      }
      return { ok: true, data: snap.data, savedAt: snap.savedAt };
    }).catch(function () { return { ok: false }; });
  };
  Store.prototype.clearUploaded = function () {
    return idbDel(KEY + '.' + this.UPLOAD_KEY).catch(function () { return false; });
  };

  /** 保存到 IndexedDB（供下次秒开） */
  Store.prototype.save = function () {
    const payload = {
      version: VERSION,
      savedAt: Date.now(),
      meta: this.meta,
      hasUploaded: this.hasUploaded,
      battles: this.battles
    };
    return idbPut(KEY, payload).then(function () { return true; })
      .catch(function () { return false; });
  };

  /** 读取缓存（返回 Promise<{ok, count}>） */
  Store.prototype.loadCache = function () {
    const self = this;
    return idbGet(KEY).then(function (snap) {
      if (!snap || snap.version !== VERSION || !Array.isArray(snap.battles)) {
        return { ok: false };
      }
      self.set(snap.battles, snap.meta, { uploaded: !!snap.hasUploaded });
      return { ok: true, count: snap.battles.length };
    }).catch(function () {
      return { ok: false };
    });
  };

  Store.prototype.clear = function () {
    this.battles = [];
    this.byId = new Map();
    this.meta = null;
    this.loadedAt = null;
    this.hasUploaded = false;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    return idbDel(KEY).catch(function () { return false; });
  };

  Store.prototype.size = function () { return this.battles.length; };

  /** 按类型统计（界面自检用） */
  Store.prototype.counts = function () {
    let block = 0, child = 0;
    for (let i = 0; i < this.battles.length; i++) {
      if (this.battles[i].recordType === 'child') child++; else block++;
    }
    return { total: this.battles.length, block: block, child: child };
  };

  AC.Store = Store;
})(window.AC);
