/* 云端同步模块测试:node test/cloud.test.js(加密用 WebCrypto,Node≥20 可用) */
const C = require('../core.js');
const CL = require('../cloud.js');
const assert = require('assert');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } }

(async () => {
  console.log('— 加密回环 —');
  const state = C.emptyState();
  state.names = { a: '老公', b: '老婆' };
  state.togetherSince = '2021-09-13';
  state.periods.push({ start: '2026-11-01', end: '2026-11-05', updatedAt: 1 });
  const enc = await CL.encryptState(state, '我们的恋爱纪念日加一句暗号');
  ok(enc.v === 1 && enc.salt && enc.iv && enc.data, '密文结构完整');
  ok(!JSON.stringify(enc).includes('老婆'), '密文里看不到明文内容');
  const dec = await CL.decryptState(enc, '我们的恋爱纪念日加一句暗号');
  ok(dec.ok && dec.state.names.b === '老婆' && dec.state.periods.length === 1, '正确暗号解密还原');
  const bad = await CL.decryptState(enc, '错误的暗号');
  ok(!bad.ok && bad.looksEnc === true, '错误暗号解不开且明确标记');
  const junk = await CL.decryptState({ note: 'init' }, '任意暗号');
  ok(!junk.ok && junk.looksEnc === false, '非加密格式静默忽略');
  ok(await CL.decryptState(await CL.encryptState(state, 'a'), 'a').then(r => r.ok), '重复加密解密稳定');

  console.log('— 模拟云端同步(假 fetch) —');
  /* 场景1:云端为空 → 推送本地合并结果 */
  let putBody = null;
  global.fetch = async (url, opts) => {
    if ((opts && opts.method) === 'PATCH') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ files: { 'sync.json': { content: '{"note":"init"}' } } }) };
  };
  const r1 = await CL.cloudSync({ gistId: 'x', token: 't', pass: 'p1' }, state);
  ok(r1.ok && JSON.stringify(r1.state) === JSON.stringify(state), '云端为空:本地原样保留并推送');
  ok(putBody && putBody.files['sync.json'].content.includes('"v":1'), '推送内容为加密格式');

  /* 场景2:云端有对方数据 → 合并后返回,且推送合并结果 */
  const remoteState = C.emptyState();
  remoteState.names = { a: '', b: '' };
  remoteState.anniversaries.push({ id: 'a2', name: '领证', date: '2023-10-01', repeat: 'yearly', updatedAt: 60 });
  remoteState.periods.push({ start: '2026-10-04', end: '', updatedAt: 90 });
  const encRemote = await CL.encryptState(remoteState, 'p1');
  global.fetch = async (url, opts) => {
    if ((opts && opts.method) === 'PATCH') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ files: { 'sync.json': { content: JSON.stringify(encRemote) } } }) };
  };
  const r2 = await CL.cloudSync({ gistId: 'x', token: 't', pass: 'p1' }, state);
  ok(r2.ok, '云端有数据:同步成功');
  ok(r2.state.anniversaries.some(a => a.id === 'a2') && r2.state.periods.some(p => p.start === '2026-11-01'),
    '合并结果同时包含双方数据');
  const pushedBack = await CL.decryptState(JSON.parse(putBody.files['sync.json'].content), 'p1');
  ok(pushedBack.ok && pushedBack.state.periods.length === 2, '推送回去的是合并后的完整数据');

  /* 场景3:暗号不一致 → 明确报错,不推送 */
  global.fetch = async (url, opts) => ({
    ok: true, json: async () => ({ files: { 'sync.json': { content: JSON.stringify(encRemote) } } })
  });
  const r3 = await CL.cloudSync({ gistId: 'x', token: 't', pass: '另一个暗号' }, state);
  ok(!r3.ok && r3.wrongPass === true && /暗号/.test(r3.error), '暗号不一致:明确提示且不覆盖');

  /* 场景4:断网 → 报错不丢本地 */
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const r4 = await CL.cloudSync({ gistId: 'x', token: 't', pass: 'p1' }, state);
  ok(!r4.ok && JSON.stringify(r4.state) === JSON.stringify(state), '断网:报错且本地数据不动');

  /* 场景5:云端文件过大被截断 → 中止同步,绝不覆盖 */
  global.fetch = async () => ({ ok: true, json: async () => ({ files: { 'sync.json': { truncated: true, content: '' } } }) });
  const r5 = await CL.cloudSync({ gistId: 'x', token: 't', pass: 'p1' }, state);
  ok(!r5.ok && /截断/.test(r5.error), '截断保护:中止且明确报错');

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
