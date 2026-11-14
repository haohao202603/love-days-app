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

  /* 取核心库:浏览器由 script 顺序保证;Node 环境回退到 require */
  function coreApi() {
    if (global.LoveCore) return global.LoveCore;
    if (typeof require === 'function') return require('./core.js');
    throw new Error('缺少 core.js');
  }

  /*
   * 完整同步:拉取 → 解密 → 与本地合并 → 推送合并结果
   * 返回 { ok, state, error?, wrongPass? }
   */
  async function cloudSync(cfg, localState) {
    try {
      const C = coreApi();
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
      await gistPut(cfg.gistId, cfg.token, await encryptState(merged, cfg.pass));
      return { ok: true, state: merged };
    } catch (e) {
      return { ok: false, state: localState, error: (e && e.message) ? e.message : '网络异常,稍后自动重试' };
    }
  }

  const api = { setDefaultGist, getDefaultGist, encryptState, decryptState, gistGet, gistPut, cloudSync, FILE_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LoveCloud = api;
})(typeof window !== 'undefined' ? window : globalThis);
