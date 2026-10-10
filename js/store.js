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

  function Store() {
    this.battles = [];
    this.batches = [];
    this.byId = new Map();
    this._saveTimer = null;
  }

  Store.prototype.load = function () {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }

    // 旧版本存档：字段结构与现在不同，直接清掉并提示重新导入
    if (!raw) {
      let legacy = false;
      try {
        LEGACY_KEYS.forEach(function (k) {
          if (localStorage.getItem(k)) { legacy = true; localStorage.removeItem(k); }
        });
      } catch (e) { /* ignore */ }
      if (legacy && AC.util && AC.util.toast) {
        AC.util.toast('检测到旧版本存档（缺少兵种等新字段），已清除。请重新导入战报表，或点「载入示例表」。', 'warn', 9000);
      }
      return this;
    }

    try {
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.battles)) return this;
      // 版本不符：宁可重来，也不要把新旧结构混在一起
      if (data.version !== VERSION) {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        if (AC.util && AC.util.toast) {
          AC.util.toast('本地存档结构已升级，旧存档已清除。请重新导入战报表，或点「载入示例表」。', 'warn', 9000);
        }
        return this;
      }
      this.batches = data.batches || [];
      this.battles = data.battles;
      this.battles.forEach(function (b) { this.byId.set(b.id, b); }, this);
    } catch (e) {
      AC.util.toast('本地存档解析失败，已忽略：' + e.message, 'err');
    }
    return this;
  };

  Store.prototype.save = function () {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: VERSION, savedAt: Date.now(), batches: this.batches, battles: this.battles
      }));
      return true;
    } catch (e) {
      AC.util.toast('本地存储写入失败（可能超出容量限制）。建议使用「导出存档」备份数据。', 'err', 5200);
      return false;
    }
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

    let added = 0, dup = 0;
    this.batches.push(batch);
    for (let i = 0; i < battles.length; i++) {
      const b = battles[i];
      if (this.byId.has(b.id)) { dup++; continue; }
      b.batchId = batch.id;
      this.byId.set(b.id, b);
      this.battles.push(b);
      added++;
    }
    batch.added = added;
    batch.dup = dup;
    if (!added) {
      batch.empty = true;
      this.batches.pop();
      batch.id = null;
    }
    this.saveSoon();
    return { batch: batch, added: added, dup: dup };
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

  Store.prototype.clear = function () {
    this.battles = [];
    this.batches = [];
    this.byId = new Map();
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
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
