/* 日记功能测试:node test/diary.test.js */
const C = require('../core.js');
const CL = require('../cloud.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } }

function memStore() {
  const m = new Map();
  return {
    put: async (k, b) => { m.set(k, b); return true; },
    get: async (k) => m.get(k) || null,
    del: async (k) => { m.delete(k); return true; },
    keys: async () => Array.from(m.keys()),
    _m: m
  };
}

(async () => {
  console.log('— 日记合并 —');
  const L = C.emptyState(), R = C.emptyState();
  L.diary.push({ id: 'd1', by: 'a', date: '2026-11-14', text: '我的日记', photos: [{ id: 'p1', gistId: null, w: 100, h: 80 }], createdAt: 1, updatedAt: 5 });
  R.diary.push({ id: 'd2', by: 'b', date: '2026-11-13', text: '对方的日记', photos: [], createdAt: 2, updatedAt: 6 });
  const m1 = C.mergeState(L, R);
  ok(m1.diary.length === 2, '双方日记合并为两条');
  const L2 = C.emptyState(); L2.diary.push({ id: 'd1', text: '新版', updatedAt: 10 });
  const R2 = C.emptyState(); R2.diary.push({ id: 'd1', text: '旧版', updatedAt: 3 });
  ok(C.mergeState(L2, R2).diary[0].text === '新版', '同 id 取更新时间新者');
  const L3 = C.emptyState(); L3.diary.push({ id: 'd1', text: 'a', updatedAt: 9, deleted: true });
  const R3 = C.emptyState(); R3.diary.push({ id: 'd1', text: 'a', updatedAt: 1 });
  ok(C.mergeState(L3, R3).diary.length === 0, '已删除的日记不再出现');
  const L4 = C.emptyState(); L4.pendingPhotoDeletes = ['g1'];
  const R4 = C.emptyState(); R4.pendingPhotoDeletes = ['g2'];
  const m4 = C.mergeState(L4, R4);
  ok(m4.pendingPhotoDeletes.length === 2 && m4.pendingPhotoDeletes.includes('g1'), '待删云端照片列表取并集');

  console.log('— 照片加密 —');
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const encP = await CL.encryptBytes(bytes, '暗号q');
  ok(encP.kind === 'bin' && encP.data.length > 0, '照片密文结构完整');
  const decP = await CL.decryptBytes(encP, '暗号q');
  ok(decP.ok && decP.bytes.length === 2048 && decP.bytes[100] === 100, '正确暗号解密还原字节');
  ok(!(await CL.decryptBytes(encP, '错误的')).ok, '错误暗号解不开');

  console.log('— 模拟两台手机的照片同步 —');
  /* 假 GitHub:gists 存内存 */
  const gists = new Map();
  gists.set('main', { files: { 'sync.json': { content: '{"note":"init"}' } } }); /* 主同步文件(真实场景已存在) */
  let nextId = 1;
  const deletedIds = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET';
    if (u === 'https://api.github.com/gists/' && method === 'POST') {
      const body = JSON.parse(opts.body);
      const id = 'g' + (nextId++);
      gists.set(id, { files: JSON.parse(JSON.stringify(body.files)) });
      return { ok: true, status: 201, json: async () => ({ id }) };
    }
    const mId = u.match(/gists\/([^/]+)$/);
    if (mId) {
      const id = decodeURIComponent(mId[1]);
      if (method === 'GET') {
        const g = gists.get(id);
        if (!g) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ files: Object.fromEntries(Object.entries(g.files).map(([k, v]) => [k, { content: v.content || v }])) }) };
      }
      if (method === 'PATCH') {
        const g = gists.get(id);
        if (!g) return { ok: false, status: 404, json: async () => ({}) };
        Object.assign(g.files, JSON.parse(opts.body).files);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (method === 'DELETE') { deletedIds.push(id); gists.delete(id); return { ok: true, status: 204, json: async () => ({}) }; }
    }
    throw new Error('unexpected fetch ' + method + ' ' + u);
  };

  const entry = { id: 'd1', by: 'a', date: '2026-11-14', text: '美好的一天', photos: [{ id: 'p1', gistId: null, w: 640, h: 480 }], createdAt: 1, updatedAt: 1 };
  const stA = C.emptyState();
  stA.names = { a: '老公', b: '老婆' }; stA.meta.updatedNames = 100;
  stA.diary.push(entry);
  const storeA = memStore();
  await storeA.put('p1', new Blob([bytes], { type: 'image/jpeg' }));
  const r1 = await CL.cloudSync({ gistId: 'main', token: 't', pass: 'p' }, stA, storeA);
  ok(r1.ok, 'A 机(写日记方)同步成功');
  ok(entry.photos[0].gistId && String(entry.photos[0].gistId).indexOf('g') === 0, '照片已上传云端并回填文件 id');
  ok(storeA._m.has('p1'), '本地照片保留');

  const storeB = memStore();
  const r2 = await CL.cloudSync({ gistId: 'main', token: 't', pass: 'p' }, C.emptyState(), storeB);
  ok(r2.ok && r2.state.diary.some(d => d.id === 'd1'), 'B 机拉到日记');
  ok(storeB._m.has('p1'), 'B 机自动下载照片到本地');
  const got = await storeB.get('p1');
  const ab = new Uint8Array(await got.arrayBuffer());
  ok(ab.length === 2048 && ab[100] === 100, 'B 机照片字节与原片完全一致');

  /* 删除:云端照片一并清理(删除时间戳晚于上传,符合真实时序) */
  const stA2 = C.emptyState();
  stA2.diary.push({ id: 'd1', by: 'a', date: '2026-11-14', text: '美好的一天', photos: [{ id: 'p1', gistId: entry.photos[0].gistId, w: 640, h: 480 }], createdAt: 1, updatedAt: Date.now(), deleted: true });
  stA2.pendingPhotoDeletes.push(entry.photos[0].gistId);
  const r3 = await CL.cloudSync({ gistId: 'main', token: 't', pass: 'p' }, stA2, storeA);
  ok(r3.ok && deletedIds.includes(entry.photos[0].gistId), '删除日记后,云端照片文件被清理');
  ok(r3.state.diary.length === 0 && r3.state.pendingPhotoDeletes.length === 0, '删除元数据同步完成,待删列表清空');

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
