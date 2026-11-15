/* 我们的小日子 - 云端自动同步(GitHub Gist + AES-GCM 加密)
 * 依赖 core.js 的 mergeState。浏览器和 Node(≥20)均可运行。 */
(function (global) {
  'use strict';

  const FILE_NAME = 'sync.json';
  const API_BASE = 'https://api.github.com/gists/';

  /* ---------- 内置云端文件 ID(部署时写入) ---------- */
  let DEFAULT_GIST_ID = '';
  function setDefaultGist(id) { DEFAULT_GIST_ID = id || ''; }
  function getDefaultGist() { return DEFAULT_GIST_ID; }

  /* ---------- Base64 助手 ---------- */
  function b64encode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  }
  function b64decode(s) {
    if (typeof atob !== 'undefined') {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }

  /* ---------- 加密(AES-GCM + PBKDF2 派生密钥) ---------- */
  async function deriveKey(pass, salt) {
    const te = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', te.encode(String(pass)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* 返回 {v, salt, iv, data}(全部 base64) */
  async function encryptState(obj, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const plain = new TextEncoder().encode(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
    return { v: 1, salt: b64encode(salt), iv: b64encode(new Uint8Array(iv)), data: b64encode(new Uint8Array(cipher)) };
  }

  /* 成功返回对象;不合规或暗号错误返回 null(isEnc 标记 payload 是否为我们的加密格式) */
  async function decryptState(payload, pass) {
    try {
      if (!payload || payload.v !== 1 || !payload.salt || !payload.iv || !payload.data) return { ok: false, looksEnc: false };
      const key = await deriveKey(pass, b64decode(payload.salt));
      let plain;
      try {
        plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: b64decode(payload.iv) }, key, b64decode(payload.data));
      } catch (e) {
        return { ok: false, looksEnc: true }; /* 格式对但解不开 = 暗号不对 */
      }
      const obj = JSON.parse(new TextDecoder().decode(plain));
      if (!obj || typeof obj !== 'object') return { ok: false, looksEnc: true };
      return { ok: true, state: obj, looksEnc: true };
    } catch (e) {
      return { ok: false, looksEnc: false };
    }
  }

  /* ---------- Gist 读写 ---------- */
  function gistHeaders(token) {
    return { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
  }

  async function gistGet(id, token) {
    const res = await fetch(API_BASE + encodeURIComponent(id), { headers: gistHeaders(token) });
    if (!res.ok) throw new Error('云端拉取失败(HTTP ' + res.status + (res.status === 401 ? ',令牌可能填错' : res.status === 404 ? ',云端文件ID可能填错' : '') + ')');
    const g = await res.json();
    const f = g.files && g.files[FILE_NAME];
    if (f && f.truncated) throw new Error('云端数据过大被截断,为防覆盖已中止同步');
    return f ? (f.content || '') : '';
  }

  async function gistPut(id, token, encPayload) {
    const res = await fetch(API_BASE + encodeURIComponent(id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, gistHeaders(token)),
      body: JSON.stringify({ files: (function () { const o = {}; o[FILE_NAME] = { content: JSON.stringify(encPayload) }; return o; })() })
    });
    if (!res.ok) throw new Error('云端上传失败(HTTP ' + res.status + (res.status === 401 ? ',令牌可能填错或过期' : res.status === 403 ? ',权限不足或触发限流,稍后再试' : '') + ')');
  }

  /* ---------- 照片独立云端文件(每张一个私密 gist,内容加密) ---------- */

  async function photoGistCreate(token, encJson) {
    /* 注意:创建接口不能带尾斜杠(/gists/ 会 404),必须是 /gists */
    const res = await fetch(API_BASE.replace(/\/+$/, ''), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, gistHeaders(token)),
      body: JSON.stringify({ description: 'img', public: false, files: { 'photo.jpg': { content: encJson } } })
    });
    if (!res.ok) throw new Error('照片上传失败(HTTP ' + res.status + ')');
    const g = await res.json();
    return g.id;
  }

  async function photoGistGet(token, gid) {
    const res = await fetch(API_BASE + encodeURIComponent(gid), { headers: gistHeaders(token) });
    if (!res.ok) throw new Error('照片拉取失败(HTTP ' + res.status + ')');
    const g = await res.json();
    const f = g.files && g.files['photo.jpg'];
    return f ? (f.content || '') : '';
  }

  async function photoGistDelete(token, gid) {
    try {
      const res = await fetch(API_BASE + encodeURIComponent(gid), { method: 'DELETE', headers: gistHeaders(token) });
      return res.ok || res.status === 404;
    } catch (e) { return false; }
  }

  /* ---------- 二进制(照片)加密 ---------- */

  async function encryptBytes(bytes, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes);
    return { v: 1, kind: 'bin', salt: b64encode(salt), iv: b64encode(new Uint8Array(iv)), data: b64encode(new Uint8Array(cipher)) };
  }

  async function decryptBytes(payload, pass) {
    if (!payload || payload.kind !== 'bin' || !payload.salt || !payload.iv || !payload.data) return { ok: false, looksEnc: false };
    try {
      const key = await deriveKey(pass, b64decode(payload.salt));
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(payload.iv) }, key, b64decode(payload.data));
      } catch (e) { return { ok: false, looksEnc: true }; }
      return { ok: true, bytes: new Uint8Array(plain), looksEnc: true };
    } catch (e) { return { ok: false, looksEnc: false }; }
  }

  /* ---------- 本地照片仓库(IndexedDB,浏览器专用) ---------- */

  function makeIdbStore() {
    let dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (resolve, reject) {
        const r = indexedDB.open('lovedays-media', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('photos'); };
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
      return dbp;
    }
    return {
      put: async function (k, blob) {
        const d = await db();
        return new Promise(function (res, rej) {
          const t = d.transaction('photos', 'readwrite');
          t.objectStore('photos').put(blob, k);
          t.oncomplete = function () { res(true); };
          t.onerror = function () { rej(t.error); };
        });
      },
      get: async function (k) {
        const d = await db();
        return new Promise(function (res, rej) {
          const rq = d.transaction('photos').objectStore('photos').get(k);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { rej(rq.error); };
        });
      },
      del: async function (k) {
        const d = await db();
        return new Promise(function (res, rej) {
          const t = d.transaction('photos', 'readwrite');
          t.objectStore('photos').delete(k);
          t.oncomplete = function () { res(true); };
          t.onerror = function () { rej(t.error); };
        });
      },
      keys: async function () {
        const d = await db();
        return new Promise(function (res, rej) {
          const rq = d.transaction('photos').objectStore('photos').getAllKeys();
          rq.onsuccess = function () { res(rq.result || []); };
          rq.onerror = function () { rej(rq.error); };
        });
      }
    };
  }

  const media = (typeof indexedDB !== 'undefined') ? makeIdbStore() : null;

  /* 取核心库:浏览器由 script 顺序保证;Node 环境回退到 require */
  function coreApi() {
    if (global.LoveCore) return global.LoveCore;
    if (typeof require === 'function') return require('./core.js');
    throw new Error('缺少 core.js');
  }

  /*
   * 完整同步:拉取 → 解密 → 合并 → 照片上云/落库 → 清理 → 推送
   * 返回 { ok, state, error?, wrongPass? }
   * store 可注入(测试用内存仓库);默认用 IndexedDB
   */
  async function cloudSync(cfg, localState, store) {
    try {
      const C = coreApi();
      store = store || media;
      if (!cfg || !cfg.gistId || !cfg.token || !cfg.pass) return { ok: false, state: localState, error: '云端配置不完整' };
      const raw = await gistGet(cfg.gistId, cfg.token);
      let remote = null;
      if (raw && raw.trim()) {
        let payload;
        try { payload = JSON.parse(raw); } catch (e) { payload = null; }
        const d = await decryptState(payload, cfg.pass);
        if (!d.ok && d.looksEnc) {
          return { ok: false, state: localState, error: '加密暗号和云端不一致,请检查后重试', wrongPass: true };
        }
        if (d.ok) remote = d.state;
      }
      const merged = C.mergeState(localState, remote);

      /* --- 照片处理 --- */
      let photoFails = 0;
      if (store) {
        const bg = merged.bgPhoto;
        /* 1. 上传本地新增的照片(还没有云端文件 id 的) */
        for (const d of (merged.diary || [])) {
          for (const ph of (d.photos || [])) {
            if (ph.gistId) continue;
            try {
              const blob = await store.get(ph.id);
              if (!blob) continue; /* 本地也没有,等下一轮 */
              const bytes = new Uint8Array(await blob.arrayBuffer());
              if (bytes.length > 900 * 1024) throw new Error('照片过大');
              const enc = await encryptBytes(bytes, cfg.pass);
              ph.gistId = await photoGistCreate(cfg.token, JSON.stringify(enc));
              d.updatedAt = Date.now();
            } catch (e) { photoFails++; /* 单张失败不阻塞,下一轮重试 */ }
          }
        }
        /* 1b. 上传首页背景图 */
        if (bg && bg.id && !bg.gistId) {
          try {
            const blob = await store.get(bg.id);
            if (blob) {
              const bytes = new Uint8Array(await blob.arrayBuffer());
              if (bytes.length > 900 * 1024) throw new Error('图片过大');
              const enc = await encryptBytes(bytes, cfg.pass);
              bg.gistId = await photoGistCreate(cfg.token, JSON.stringify(enc));
            }
          } catch (e) { photoFails++; /* 失败下一轮重试 */ }
        }
        /* 2. 执行待删照片的云端清理 */
        const stillPending = [];
        for (const gid of (merged.pendingPhotoDeletes || [])) {
          if (await photoGistDelete(cfg.token, gid)) continue;
          stillPending.push(gid); /* 删失败(如断网)留到下轮 */
        }
        merged.pendingPhotoDeletes = stillPending;
        /* 3. 下载本地缺少的照片 */
        let have = new Set();
        try { have = new Set(await store.keys()); } catch (e) {}
        for (const d of (merged.diary || [])) {
          for (const ph of (d.photos || [])) {
            if (!ph.gistId || have.has(ph.id)) continue;
            try {
              const rawP = await photoGistGet(cfg.token, ph.gistId);
              if (!rawP) continue;
              const dec = await decryptBytes(JSON.parse(rawP), cfg.pass);
              if (dec.ok) await store.put(ph.id, new Blob([dec.bytes], { type: 'image/jpeg' }));
            } catch (e) { /* 单张失败不阻塞 */ }
          }
        }
        /* 3b. 下载首页背景图 */
        if (bg && bg.id && bg.gistId && !have.has(bg.id)) {
          try {
            const rawP = await photoGistGet(cfg.token, bg.gistId);
            if (rawP) {
              const dec = await decryptBytes(JSON.parse(rawP), cfg.pass);
              if (dec.ok) await store.put(bg.id, new Blob([dec.bytes], { type: 'image/jpeg' }));
            }
          } catch (e) { /* 失败不阻塞 */ }
        }
        /* 4. 清理本地不再被引用的照片 */
        try {
          const ref = new Set();
          for (const d of (merged.diary || [])) for (const ph of (d.photos || [])) ref.add(ph.id);
          if (bg && bg.id) ref.add(bg.id);
          for (const k of await store.keys()) if (!ref.has(k)) await store.del(k);
        } catch (e) {}
      }

      await gistPut(cfg.gistId, cfg.token, await encryptState(merged, cfg.pass));
      return { ok: true, state: merged, photoFails: photoFails };
    } catch (e) {
      return { ok: false, state: localState, error: (e && e.message) ? e.message : '网络异常,稍后自动重试' };
    }
  }

  const api = { setDefaultGist, getDefaultGist, encryptState, decryptState, encryptBytes, decryptBytes,
    gistGet, gistPut, photoGistCreate, photoGistGet, photoGistDelete,
    cloudSync, media: media, FILE_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LoveCloud = api;
})(typeof window !== 'undefined' ? window : globalThis);
