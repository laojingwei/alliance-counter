window.AC = window.AC || {};

/* ============================================================
   数据仓库：localStorage 持久化 + 多次导入自动叠加去重
   ============================================================ */
(function (AC) {
  'use strict';

  // 数据结构版本：解析结果里加了新字段（如兵种 troopSig、红度/品级）时就 +1 并改 KEY，
  // 这样浏览器里的旧存档不会拿给新代码用（否则会出现「兵种不显示」这类残缺记录）。
  const KEY = 'ac.battles.v3';
  const LEGACY_KEYS = ['ac.battles.v2', 'ac.battles.v1'];
  const VERSION = 3;
  const PREV_KEY = KEY + '.prev';   // 上一次的存档备份（默认展示内置数据时保留）

  /* ---------------- 持久化：优先 IndexedDB ----------------
     localStorage 每个域名只有约 5MB，而战报明细动辄十几 MB（每场带 3 名武将的技能/装备/战马/属性），
     大表根本写不进去（现象就是「本地存储写入失败」，刷新后数据丢失）。
     IndexedDB 的配额是几百 MB 起步，完全放得下；读写失败或不支持（含 jsdom 测试环境）时
     自动回退 localStorage，旧存档也照常能读。 */
  const IDB_NAME = 'alliance-counter';
  const IDB_STORE = 'snapshot';

  /* 超时兜底：IndexedDB 可能因为「别的标签页占着库（onblocked）」「浏览器隐私模式禁用」
     这类原因**既不成功也不失败**，那样 await 会永远挂着——启动就会卡在加载遮罩上。
     所以每个 IDB 操作都带超时，超时就当失败，走 localStorage 回退。 */
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
        var db = req.result;
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
        const settle = function (fn, arg) { if (settled) return; settled = true; clearTimeout(timer); try { db.close(); } catch (e) { /* ignore */ } fn(arg); };
        const timer = setTimeout(function () { settle(reject, new Error('idb put timeout')); }, IDB_TIMEOUT * 4);
        var tx = db.transaction(IDB_STORE, 'readwrite');
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
        const settle = function (fn, arg) { if (settled) return; settled = true; clearTimeout(timer); try { db.close(); } catch (e) { /* ignore */ } fn(arg); };
        const timer = setTimeout(function () { settle(reject, new Error('idb get timeout')); }, IDB_TIMEOUT);
        var tx = db.transaction(IDB_STORE, 'readonly');
        var r = tx.objectStore(IDB_STORE).get(key);
        r.onsuccess = function () { settle(resolve, r.result || null); };
        r.onerror = function () { settle(reject, r.error); };
      });
    });
  }
  function idbDel(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        let settled = false;
        const settle = function (arg) { if (settled) return; settled = true; clearTimeout(timer); try { db.close(); } catch (e) { /* ignore */ } resolve(arg); };
        const timer = setTimeout(function () { settle(false); }, IDB_TIMEOUT);
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE)['delete'](key);
        tx.oncomplete = function () { settle(true); };
        tx.onerror = function () { settle(false); };
      });
    });
  }
  /** 把「当前存档」写进 localStorage（回退路径；小数据才放得下） */
  function lsPut(key, payload) {
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  }
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /** 清掉更早版本留下的存档键（字段结构不同，留着只会误导） */
  function cleanLegacy() {
    let legacy = false;
    try {
      LEGACY_KEYS.forEach(function (k) {
        if (localStorage.getItem(k)) { legacy = true; localStorage.removeItem(k); }
      });
    } catch (e) { /* ignore */ }
    if (legacy && AC.util && AC.util.toast) {
      AC.util.toast('检测到旧版本存档（缺少兵种等新字段），已清除。请重新导入战报表，或点「载入示例表」。', 'warn', 9000);
    }
    return legacy;
  }

  function Store() {
    this.battles = [];
    this.batches = [];
    this.byId = new Map();
    this._saveTimer = null;
    cleanLegacy();      // 每次启动都清一遍（?demo=1 这类路径不会走 load()）
  }

  /** 把一份快照装进仓库（IndexedDB 与 localStorage 两条路径共用） */
  Store.prototype._applySnapshot = function (data) {
    if (!data || !Array.isArray(data.battles)) return this;
    // 版本不符：宁可重来，也不要把新旧结构混在一起
    if (data.version !== VERSION) {
      idbDel('latest').catch(function () { /* ignore */ });
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      if (AC.util && AC.util.toast) {
        AC.util.toast('本地存档结构已升级，旧存档已清除。请重新导入战报表，或点「载入示例表」。', 'warn', 9000);
      }
      return this;
    }
    this.batches = data.batches || [];
    this.battles = data.battles;
    this.byId = new Map();
    this.battles.forEach(function (b) { this.byId.set(b.id, b); }, this);
    return this;
  };

  /** 回退路径：从 localStorage 读（旧存档、或不支持 IndexedDB 的环境） */
  Store.prototype._loadLocal = function () {
    const raw = lsGet(KEY);
    if (!raw) {
      cleanLegacy();
      return this;
    }
    try {
      this._applySnapshot(JSON.parse(raw));
    } catch (e) {
      AC.util.toast('本地存档解析失败，已忽略：' + e.message, 'err');
    }
    return this;
  };

  /** 载入存档：先 IndexedDB，再回退 localStorage（返回 Promise） */
  Store.prototype.load = function () {
    const self = this;
    return idbGet('latest').then(function (snap) {
      if (snap) return self._applySnapshot(snap);
      return self._loadLocal();
    }).catch(function () {
      return self._loadLocal();
    });
  };

  Store.prototype.save = function () {
    const payload = { version: VERSION, savedAt: Date.now(), batches: this.batches, battles: this.battles };
    // 优先 IndexedDB：容量按域名配额（几百 MB 起），十几 MB 的战报明细放得下。
    // 写成功后清掉 localStorage 里那份旧的小存档，避免两份数据不一致。
    return idbPut('latest', payload).then(function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      return true;
    }).catch(function () {
      // 回退 localStorage：数据小的时候能存下，真的超限才失败
      if (lsPut(KEY, payload)) return true;
      if (AC.util && AC.util.toast) {
        AC.util.toast('本地存档写入失败（数据超出浏览器存储上限）。建议用「导出存档」备份，或先「清空全部数据」再少量导入。', 'err', 6000);
      }
      return false;
    });
  };

  Store.prototype.saveSoon = function () {
    const self = this;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(function () { self.save(); }, 500);
  };

  /**
   * 叠加导入
   * @param {Array} battles 规范化后的战斗数组
   * @param {Object} meta { name, fileName, rowTotal, invalid }
   * @returns {Object} { batch, added, dup }
   */
  Store.prototype.add = function (battles, meta) {
    meta = meta || {};
    const batch = {
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: meta.name || '未命名战报表',
      ts: Date.now(),
      rowTotal: meta.rowTotal || battles.length,
      invalid: meta.invalid || 0
    };

    let added = 0, dup = 0, replaced = 0;
    this.batches.push(batch);
    for (let i = 0; i < battles.length; i++) {
      const b = battles[i];
      const old = this.byId.get(b.id);
      if (old) {
        dup++;
        /* 同一场战斗又导了一次：用**新导入的**替换旧的，而不是保留旧的。
           内置示例是脱敏版（玩家显示成「玩家XXXX」），真实数据是真名；
           若保留示例，用户导入后按自己的名字查不到记录，看起来就像「战报不全」。
           战斗内容一致，替换不损失信息，只是让显示回到用户导入的那一份。
           注意：替换不算「新增」，记录仍归属原批次，批次管理（删除表）才不会有孤儿记录。 */
        const idx = this.battles.indexOf(old);
        if (idx >= 0) {
          b.batchId = old.batchId;
          this.byId.set(b.id, b);
          this.battles[idx] = b;
          replaced++;
        }
        continue;
      }
      b.batchId = batch.id;
      this.byId.set(b.id, b);
      this.battles.push(b);
      added++;
    }
    batch.added = added;
    batch.dup = dup;
    batch.replaced = replaced;
    if (!added) {
      batch.empty = true;
      this.batches.pop();
      batch.id = null;
    }
    this.saveSoon();
    return { batch: batch, added: added, dup: dup, replaced: replaced };
  };

  Store.prototype.removeBatch = function (batchId) {
    const before = this.battles.length;
    this.battles = this.battles.filter(function (b) { return b.batchId !== batchId; });
    this.batches = this.batches.filter(function (b) { return b.id !== batchId; });
    this.byId = new Map();
    this.battles.forEach(function (b) { this.byId.set(b.id, b); }, this);
    this.saveSoon();
    return before - this.battles.length;
  };

  /** 把当前存档挪到备份（默认展示内置数据前调用，避免覆盖用户上次的数据） */
  Store.prototype.stash = function () {
    if (!this.battles.length) return Promise.resolve(false);
    const payload = { version: VERSION, savedAt: Date.now(), batches: this.batches, battles: this.battles };
    return idbPut('prev', payload).then(function () { return true; }).catch(function () {
      return lsPut(PREV_KEY, payload);
    });
  };

  /** 是否存在可恢复的上次存档（返回 Promise） */
  Store.prototype.hasPrev = function () {
    return idbGet('prev').then(function (x) { return !!x; }).catch(function () {
      try { return !!localStorage.getItem(PREV_KEY); } catch (e) { return false; }
    });
  };

  /** 载入上次存档（替换当前数据，返回 Promise<{ok,n,batches}>） */
  Store.prototype.restorePrev = function () {
    const self = this;
    const fromLocal = function () {
      const raw = lsGet(PREV_KEY);
      if (!raw) return { ok: false, reason: 'empty' };
      let data = null;
      try { data = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'parse' }; }
      if (!data || !Array.isArray(data.battles)) return { ok: false, reason: 'shape' };
      self._applySnapshot(data);
      self.save();
      return { ok: true, n: self.battles.length, batches: self.batches.length };
    };
    return idbGet('prev').then(function (snap) {
      if (!snap) return fromLocal();
      if (!snap || !Array.isArray(snap.battles)) return { ok: false, reason: 'shape' };
      self._applySnapshot(snap);
      self.save();
      return { ok: true, n: self.battles.length, batches: self.batches.length };
    }).catch(function () {
      return fromLocal();
    });
  };

  Store.prototype.clear = function () {
    this.battles = [];
    this.batches = [];
    this.byId = new Map();
    try { localStorage.removeItem(KEY); localStorage.removeItem(PREV_KEY); } catch (e) { /* ignore */ }
    return idbDel('latest').then(function () { return idbDel('prev'); }).catch(function () { return false; });
  };

  Store.prototype.exportJSON = function () {
    return JSON.stringify({
      version: VERSION,
      exportedAt: new Date().toISOString(),
      batches: this.batches,
      battles: this.battles
    }, null, 1);
  };

  /** 合并导入存档（同样按 id 去重叠加） */
  Store.prototype.importJSON = function (text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.battles)) throw new Error('存档格式不正确');
    const batch = {
      id: 'b' + Date.now().toString(36),
      name: '存档恢复 ' + new Date().toLocaleString('zh-CN'),
      ts: Date.now(),
      rowTotal: data.battles.length
    };
    this.batches.push(batch);
    let added = 0, dup = 0;
    data.battles.forEach(function (b) {
      if (!b || !b.id) return;
      if (this.byId.has(b.id)) { dup++; return; }
      b.batchId = batch.id;
      this.byId.set(b.id, b);
      this.battles.push(b);
      added++;
    }, this);
    batch.added = added;
    batch.dup = dup;
    if (!added) { this.batches.pop(); }
    this.saveSoon();
    return { added: added, dup: dup };
  };

  Store.prototype.size = function () { return this.battles.length; };

  AC.Store = Store;
})(window.AC);
