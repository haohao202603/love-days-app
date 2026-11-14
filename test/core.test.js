/* 核心逻辑测试:node test/core.test.js */
const C = require('../core.js');

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg + '\n      期望: ' + b + '\n      实际: ' + a); }
}

console.log('— 日期基础 —');
eq(C.daysBetween('2026-09-13', '2026-09-13'), 0, '同一天为 0');
eq(C.daysBetween('2026-09-01', '2026-09-13'), 12, '普通间隔');
eq(C.daysBetween('2025-12-30', '2026-01-02'), 3, '跨年');
eq(C.daysBetween('2024-02-28', '2024-03-01'), 2, '闰年 2/29');
eq(C.daysBetween('2023-02-28', '2023-03-01'), 1, '平年 2 月');
eq(C.togetherDays('2026-09-13', '2026-09-13'), 1, '在一起第一天是第 1 天');
eq(C.togetherDays('2020-02-29', '2026-09-13'), C.daysBetween('2020-02-29', '2026-09-13') + 1, '闰日开始的天数');

console.log('— 纪念日 —');
eq(C.nextOccurrence('2020-05-20', 'yearly', '2026-09-13'), '2027-05-20', '今年已过取明年');
eq(C.nextOccurrence('2020-05-20', 'yearly', '2026-05-20'), '2026-05-20', '今天就是周年');
eq(C.nextOccurrence('2020-02-29', 'yearly', '2026-01-01'), '2026-03-01', '2/29 平年顺延到 3/1');
eq(C.nextOccurrence('2026-10-01', 'once', '2026-09-13'), '2026-10-01', '单次未到');
eq(C.nextOccurrence('2026-09-01', 'once', '2026-09-13'), null, '单次已过为 null');
eq(C.nextAnniversaryOfLove('2021-09-13', '2026-09-13'), { date: '2026-09-13', years: 5, daysLeft: 0 }, '五周年当天');

console.log('— 月经周期 —');
const today = '2026-09-13';
/* 6 次记录,间隔 28/29/27/28/30 → 平均 28.4 → 28 */
const periods = [
  { start: '2026-03-01', end: '2026-03-05' },
  { start: '2026-03-29', end: '2026-04-02' },
  { start: '2026-04-26', end: '2026-04-30' },
  { start: '2026-05-24', end: '2026-05-28' },
  { start: '2026-06-21', end: '' },
  { start: '2026-08-16', end: '' }
];
const st = C.periodStats(periods, today);
eq(st.avgDuration, 5, '平均经期长度 = 5(有 end 的 4 次,各 5 天)');
/* 间隔:28,28,28,28,56 → 剔除 56 → 平均 28 */
eq(st.avgCycle, 28, '异常间隔 56 被剔除,平均周期 28');
eq(st.lastStart, '2026-08-16', '最后一次开始日');
eq(st.nextStart, '2026-09-13', '下次预测 = lastStart+28');
eq(st.ovulation, '2026-08-30', '排卵日 = 下次开始前 14 天');
eq(st.fertileStart, '2026-08-25', '易孕开始 = 排卵前 5 天');
eq(st.fertileEnd, '2026-09-03', '易孕结束 = 排卵后 4 天');
eq(st.inPeriodDay, null, '预测期首日不算"经期中"(以实际记录为准)');

console.log('— 经期中判定 —');
const st2 = C.periodStats([{ start: '2026-09-11', end: '' }], '2026-09-13');
eq(st2.inPeriodDay, 3, '9-11 开始、默认 5 天,今天第 3 天');
const st3 = C.periodStats([{ start: '2026-09-01', end: '2026-09-05' }], '2026-09-13');
eq(st3.inPeriodDay, null, '经期已结束不在经期中');

console.log('— 日历状态 —');
const p1 = [{ start: '2026-09-01', end: '2026-09-05' }];
eq(C.statusForDate('2026-09-03', p1, today), 'period', '实际经期日');
eq(C.statusForDate('2026-09-29', p1, today), 'predicted', '预测经期 9-29(+28)起 5 天内(虚线标记)');
eq(C.statusForDate('2026-09-30', p1, today), 'predicted', '预测经期第 2 天');
eq(C.statusForDate('2026-09-15', p1, today), 'ovulation', '排卵日 = 9-29 前推 14 天 = 9-15');
eq(C.statusForDate('2026-09-19', p1, today), 'fertile', '易孕 = 9-10~9-19');
eq(C.statusForDate('2026-09-21', p1, today), null, '安全期无标记');
eq(C.statusForDate('2026-10-27', p1, today), 'predicted', '第二个预测周期(+56)也在范围内');
const p2 = [{ start: '2026-07-01', end: '' }, { start: '2026-07-29', end: '' }];
eq(C.statusForDate('2026-07-10', p2, today), 'fertile', '历史易孕期开始 = 排卵 7-15 前推 5 天 = 7-10');
eq(C.statusForDate('2026-07-09', p2, today), null, '易孕期之前是安全期');
eq(C.statusForDate('2026-07-15', p2, today), 'ovulation', '历史排卵日回溯');
eq(C.statusForDate('2026-07-02', p2, today), 'period', '历史经期(无 end 用默认 5 天)');

console.log('— 日历网格 —');
eq(C.monthGrid(2026, 9)[0], null, '2026-09-01 是周二,前 2 格为空(周日起头)');
eq(C.monthGrid(2026, 9).filter(Boolean)[0], '2026-09-01', '第一格日期 9-01');
eq(C.monthGrid(2026, 9).length % 7, 0, '网格是 7 的倍数');

console.log('— 同步码 —');
const s = C.emptyState();
s.names = { a: '老公', b: '老婆' };
s.togetherSince = '2021-09-13';
s.meta.updatedTogether = 100;
s.anniversaries.push({ id: 'a1', name: '生日', date: '1999-01-01', repeat: 'yearly', updatedAt: 1 });
s.periods.push({ start: '2026-08-16', end: '2026-08-20', updatedAt: 1 });
const code = C.makeSyncCode(s);
eq(C.parseSyncCode('  随手复制带前缀 ' + code + '\n') != null, true, '解析带前后缀的码');
const back = C.parseSyncCode(code);
eq(back.names, s.names, '中文名无损');
eq(back.togetherSince, '2021-09-13', '日期无损');
eq(back.periods, s.periods, '经期无损');
eq(C.parseSyncCode('垃圾文本'), null, '垃圾码返回 null');

console.log('— 双向合并 —');
/* 本机:有纪念日 a1 更新版 + 经期 P1;远端:有纪念日 a1 旧版 + 新纪念日 a2 + 经期 P2 */
const local = C.emptyState();
local.anniversaries.push({ id: 'a1', name: '生日-新版', date: '1999-01-01', repeat: 'yearly', updatedAt: 200 });
local.periods.push({ start: '2026-08-16', end: '', updatedAt: 100 });
const remote = C.emptyState();
remote.anniversaries.push({ id: 'a1', name: '生日-旧版', date: '1999-01-01', repeat: 'yearly', updatedAt: 50 });
remote.anniversaries.push({ id: 'a2', name: '领证', date: '2022-10-01', repeat: 'yearly', updatedAt: 60 });
remote.periods.push({ start: '2026-07-19', end: '', updatedAt: 90 });
const m = C.mergeState(local, remote);
eq(m.anniversaries.length, 2, '纪念日合并为 2 条');
eq(m.anniversaries.find(a => a.id === 'a1').name, '生日-新版', '同 id 取更新时间新者');
eq(m.periods.length, 2, '经期按开始日合并去重');
/* 合并幂等:再合并一次结果不变 */
const m2 = C.mergeState(m, remote);
eq(m2.anniversaries.length, 2, '重复导入幂等');
/* 删除同步:合并后本机删除 a2,远端仍旧版 → 删除生效 */
const delLocal = C.mergeState(local, remote);
const a2 = delLocal.anniversaries.find(a => a.id === 'a2');
a2.deleted = true; a2.updatedAt = 300;
const m3 = C.mergeState(delLocal, remote);
eq(m3.anniversaries.length, 1, '删除也随新时间戳同步');
/* togetherSince 取新 */
const lt = C.emptyState(), rt = C.emptyState();
lt.togetherSince = '2020-01-01'; lt.meta.updatedTogether = 5;
rt.togetherSince = '2021-09-13'; rt.meta.updatedTogether = 9;
eq(C.mergeState(lt, rt).togetherSince, '2021-09-13', '纪念日起点新者胜');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
