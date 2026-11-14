/* 我们的小日子 - 核心逻辑(纯函数,浏览器/Node 通用,零依赖) */
(function (global) {
  'use strict';

  /* ---------- 日期工具(全部按本地时区,字符串统一 YYYY-MM-DD) ---------- */

  function parseDate(s) {
    if (!s) return null;
    const p = String(s).split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayStr(now) {
    return fmtDate(now || new Date());
  }

  function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return fmtDate(d);
  }

  /* b - a,单位:天 */
  function daysBetween(a, b) {
    const da = parseDate(a), db = parseDate(b);
    return Math.round((db - da) / 86400000);
  }

  /* 在一起第 N 天:从第一天算起 */
  function togetherDays(start, today) {
    if (!start) return null;
    return daysBetween(start, today) + 1;
  }

  /* ---------- 纪念日 ---------- */

  /* 返回该纪念日的下一次发生日期;已过的单次纪念日返回 null */
  function nextOccurrence(dateStr, repeat, today) {
    const d = parseDate(dateStr);
    if (!d) return null;
    if (repeat === 'once') {
      return daysBetween(today, dateStr) >= 0 ? dateStr : null;
    }
    /* 每年重复:今年已过则取明年(2/29 平年自动落到 3/1) */
    const t = parseDate(today);
    let candidate = new Date(t.getFullYear(), d.getMonth(), d.getDate());
    if (daysBetween(today, fmtDate(candidate)) < 0) {
      candidate = new Date(t.getFullYear() + 1, d.getMonth(), d.getDate());
    }
    return fmtDate(candidate);
  }

  /* 距离下一次恋爱周年(按在一起那天)还剩几天;若今天就是周年,剩 0 天 */
  function nextAnniversaryOfLove(togetherSince, today) {
    if (!togetherSince) return null;
    const next = nextOccurrence(togetherSince, 'yearly', today);
    const years = parseDate(next).getFullYear() - parseDate(togetherSince).getFullYear();
    return { date: next, years: years, daysLeft: daysBetween(today, next) };
  }

  /* ---------- 月经周期 ---------- */

  const DEFAULT_CYCLE = 28;
  const DEFAULT_DURATION = 5;
  const MIN_CYCLE = 20, MAX_CYCLE = 45; /* 正常周期范围,间隔超出则不参与平均 */

  /*
   * periods: [{start:'YYYY-MM-DD', end:'YYYY-MM-DD'|null, updatedAt}]
   * 返回统计与预测。口径:
   *  - 平均周期 = 最近 6 个相邻间隔的平均(异常间隔剔除)
   *  - 经期长度 = 有 end 的记录取 end-start+1,平均后取整,否则默认 5 天
   *  - 下次经期 = 最后一次开始日 + 平均周期
   *  - 排卵日   = 下次经期开始前 14 天
   *  - 易孕期   = 排卵日前 5 天 ~ 后 4 天(即下次经期前 19 ~ 13 天)
   */
  function periodStats(periods, today) {
    const starts = (periods || [])
      .map(p => p.start)
      .filter(Boolean)
      .sort();
    const out = {
      hasData: starts.length > 0,
      lastStart: starts.length ? starts[starts.length - 1] : null,
      avgCycle: DEFAULT_CYCLE,
      avgDuration: DEFAULT_DURATION,
      durationsUsed: [],
      cyclesUsed: [],
      nextStart: null,
      ovulation: null,
      fertileStart: null,
      fertileEnd: null,
      inPeriodDay: null,   /* 今天是经期第几天 */
      lastEnded: null,
      daysUntilNext: null
    };
    if (!starts.length) return out;

    /* 经期长度 */
    const durs = (periods || [])
      .filter(p => p.start && p.end)
      .map(p => daysBetween(p.start, p.end) + 1)
      .filter(n => n >= 1 && n <= 14);
    out.durationsUsed = durs;
    if (durs.length) out.avgDuration = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);

    /* 平均周期 */
    const cycles = [];
    for (let i = 1; i < starts.length; i++) {
      const c = daysBetween(starts[i - 1], starts[i]);
      if (c >= MIN_CYCLE && c <= MAX_CYCLE) cycles.push(c);
    }
    out.cyclesUsed = cycles;
    const recent = cycles.slice(-6);
    if (recent.length) out.avgCycle = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);

    /* 今天是否在最近一次经期中 */
    const lastEndExclusive = addDays(out.lastStart, out.avgDuration); /* 排他 */
    if (daysBetween(out.lastStart, today) >= 0 && daysBetween(today, lastEndExclusive) > 0) {
      out.inPeriodDay = daysBetween(out.lastStart, today) + 1;
    }

    /* 预测 */
    out.nextStart = addDays(out.lastStart, out.avgCycle);
    out.daysUntilNext = daysBetween(today, out.nextStart);
    out.ovulation = addDays(out.nextStart, -14);
    out.fertileStart = addDays(out.ovulation, -5);
    out.fertileEnd = addDays(out.ovulation, 4);
    return out;
  }

  /* 未来第 k 个预测周期(k=1 为下一次) */
  function predictCycleK(stats, k) {
    const nextStart = addDays(stats.lastStart, stats.avgCycle * k);
    const ovulation = addDays(nextStart, -14);
    return {
      start: nextStart,
      end: addDays(nextStart, stats.avgDuration - 1),
      ovulation: ovulation,
      fertileStart: addDays(ovulation, -5),
      fertileEnd: addDays(ovulation, 4)
    };
  }

  /*
   * 某一天在日历上的状态:
   *  period     实际记录的经期(含历史)
   *  predicted  预测的经期(未来/未记录区域)
   *  ovulation  排卵日
   *  fertile    易孕期(非经期日)
   *  null       其他(安全期)
   * 对已记录的周期,排卵/易孕用「下一次实际开始日 - 14」回溯计算(更准);
   * 最后一次记录之后,用平均周期预测,向后最多看 predictMonths 个周期。
   */
  function statusForDate(dateStr, periods, today, predictAhead) {
    const starts = (periods || []).map(p => p.start).filter(Boolean).sort();
    if (!starts.length) return null;
    const stats = periodStats(periods, today);
    const dur = stats.avgDuration;

    /* 实际经期 */
    for (const p of (periods || [])) {
      if (!p.start) continue;
      const e = p.end ? p.end : addDays(p.start, dur - 1);
      if (daysBetween(p.start, dateStr) >= 0 && daysBetween(dateStr, e) >= 0) return 'period';
    }
    /* 历史周期:用下一次实际开始回溯排卵/易孕 */
    for (let i = 0; i < starts.length - 1; i++) {
      const nextS = starts[i + 1];
      const ov = addDays(nextS, -14);
      if (dateStr === ov) return 'ovulation';
      if (daysBetween(addDays(ov, -5), dateStr) >= 0 && daysBetween(dateStr, addDays(ov, 4)) >= 0) return 'fertile';
    }
    /* 未来预测:从第一个还没过去的预测周期开始,向后看 3 个周期
       (若已"推迟",自动把锚点顺延到今天之后的下一个预测起点) */
    const firstK = Math.max(1, Math.ceil(daysBetween(stats.lastStart, today) / stats.avgCycle) || 1);
    for (let k = firstK; k < firstK + 3; k++) {
      const c = predictCycleK(stats, k);
      if (daysBetween(c.start, dateStr) >= 0 && daysBetween(dateStr, c.end) >= 0) return 'predicted';
      if (dateStr === c.ovulation) return 'ovulation';
      if (daysBetween(c.fertileStart, dateStr) >= 0 && daysBetween(dateStr, c.fertileEnd) >= 0) return 'fertile';
    }
    return null;
  }

  /* ---------- 月历网格(周日起,前导补空) ---------- */
  function monthGrid(year, month /*1-12*/) {
    const first = new Date(year, month - 1, 1);
    const firstDow = first.getDay(); /* 0=周日 */
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(fmtDate(new Date(year, month - 1, d)));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  /* ---------- 数据与同步 ---------- */

  function emptyState() {
    return {
      meta: { updatedNames: 0, updatedTogether: 0 },
      names: { a: '', b: '' },
      togetherSince: '',
      anniversaries: [],  /* {id,name,date,repeat,updatedAt,deleted} */
      periods: [],        /* {start,end,updatedAt,deleted} */
      diary: [],          /* {id,by,date,text,photos:[{id,gistId,w,h}],createdAt,updatedAt,deleted} */
      bgPhoto: null,      /* 首页背景 {id,gistId,updatedAt};id 为空串表示已恢复默认 */
      pendingPhotoDeletes: [] /* 待删除云端照片 gist id 列表 */
    };
  }

  const SYNC_PREFIX = 'XIAORIZI1.';

  function makeSyncCode(state) {
    const payload = {
      names: state.names,
      togetherSince: state.togetherSince,
      anniversaries: state.anniversaries,
      periods: state.periods,
      meta: state.meta
    };
    const json = JSON.stringify(payload);
    const b64 = typeof btoa !== 'undefined'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf8').toString('base64');
    return SYNC_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function parseSyncCode(code) {
    try {
      let s = String(code || '').trim();
      const i = s.indexOf(SYNC_PREFIX);
      if (i >= 0) s = s.slice(i + SYNC_PREFIX.length);
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const json = typeof atob !== 'undefined'
        ? decodeURIComponent(escape(atob(s)))
        : Buffer.from(s, 'base64').toString('utf8');
      const obj = JSON.parse(json);
      if (typeof obj !== 'object' || obj === null) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function _newer(aU, bU) { return (bU || 0) > (aU || 0) ? b : a; }

  /* 双向合并:按 updatedAt 新者胜;periods 按 start 键、anniversaries 按 id 键 */
  function mergeState(local, remote) {
    const out = emptyState();
    const L = local || emptyState(), R = remote || emptyState();
    const lt = (L.meta && L.meta.updatedTogether) || 0;
    const rt = (R.meta && R.meta.updatedTogether) || 0;
    out.togetherSince = rt > lt ? (R.togetherSince || '') : (L.togetherSince || R.togetherSince || '');
    out.meta.updatedTogether = Math.max(lt, rt);

    const la = (L.meta && L.meta.updatedNames) || 0;
    const ra = (R.meta && R.meta.updatedNames) || 0;
    out.names = ra > la ? (R.names || { a: '', b: '' }) : (L.names || (R.names || { a: '', b: '' }));
    out.meta.updatedNames = Math.max(la, ra);

    /* 纪念日:按 id 合并 */
    const ann = {};
    for (const a of (L.anniversaries || [])) ann[a.id] = a;
    for (const a of (R.anniversaries || [])) {
      const old = ann[a.id];
      if (!old || (a.updatedAt || 0) > (old.updatedAt || 0)) ann[a.id] = a;
    }
    out.anniversaries = Object.values(ann).filter(a => !a.deleted);

    /* 经期:按 start 合并 */
    const per = {};
    for (const p of (L.periods || [])) per[p.start] = p;
    for (const p of (R.periods || [])) {
      const old = per[p.start];
      if (!old || (p.updatedAt || 0) > (old.updatedAt || 0)) per[p.start] = p;
    }
    out.periods = Object.values(per).filter(p => !p.deleted).map(p => ({ start: p.start, end: p.end || '', updatedAt: p.updatedAt || 0 }));

    /* 日记:按 id 合并(整条取新) */
    const dia = {};
    for (const d of (L.diary || [])) dia[d.id] = d;
    for (const d of (R.diary || [])) {
      const old = dia[d.id];
      if (!old || (d.updatedAt || 0) > (old.updatedAt || 0)) dia[d.id] = d;
    }
    out.diary = Object.values(dia).filter(d => !d.deleted);

    /* 首页背景:整对象按更新时间取新(空串 id 是"已恢复默认"的墓碑) */
    const lbT = (L.bgPhoto && L.bgPhoto.updatedAt) || 0;
    const rbT = (R.bgPhoto && R.bgPhoto.updatedAt) || 0;
    out.bgPhoto = rbT > lbT ? (R.bgPhoto || null) : (L.bgPhoto || null);

    /* 待删照片列表:取并集 */
    const pd = {};
    for (const g of (L.pendingPhotoDeletes || [])) pd[g] = 1;
    for (const g of (R.pendingPhotoDeletes || [])) pd[g] = 1;
    out.pendingPhotoDeletes = Object.keys(pd);

    return out;
  }

  const api = {
    parseDate, fmtDate, todayStr, addDays, daysBetween, togetherDays,
    nextOccurrence, nextAnniversaryOfLove,
    periodStats, predictCycleK, statusForDate, monthGrid,
    emptyState, makeSyncCode, parseSyncCode, mergeState,
    DEFAULT_CYCLE, DEFAULT_DURATION
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LoveCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
