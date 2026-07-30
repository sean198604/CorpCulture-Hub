(function () {
  'use strict';

  // ============================================================
  // EGO企业文化活动看板 — 简化版（纯前端 SPA + Node 图片上传后端）
  // ============================================================
  const STORAGE_KEY = 'culture-calendar-projects-v3';
  const SEED_FLAG = 'corpculture_seeded_v1';
  const ADMIN_LOGGED_KEY = 'corpculture_admin_logged_in';
  const ADMIN_PASSWORD = 'admin123';
  const HOLIDAY_KEY = 'culture-calendar-holidays';
  const HOLIDAY_SEED_FLAG = 'culture-calendar-holidays-seeded';
  const VIS_KEY = 'corpculture_view_visibility';

  const CATEGORIES = [
    { key: '节日', color: '#f43f5e', bg: '#ffe4e6' },
    { key: '活动', color: '#3b82f6', bg: '#dbeafe' },
    { key: '会议', color: '#22c55e', bg: '#dcfce7' },
    { key: '培训', color: '#8b5cf6', bg: '#ede9fe' },
    { key: '其他', color: '#6b7280', bg: '#f3f4f6' },
  ];

  const state = {
    view: 'activity',          // 'activity' | 'calendar' | 'monthly'
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    activityYear: (new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1), // 财年（FY N = N年7月~N+1年6月）
    monthlyYear: new Date().getFullYear(),
    isLoggedIn: false,
    projects: [],
    holidays: [],
    visibility: { calendar: false, monthly: false },
    editingId: null,
  };

  // ============================================================
  // 工具函数
  // ============================================================
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }
  function pad2(n) { return n.toString().padStart(2, '0'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function hexToRgba(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return 'rgba(79,110,247,' + alpha + ')';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function fmtDate(d) {
    return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : '';
  }
  function parseDate(s) {
    if (!s) return null;
    const [y, m, day] = String(s).split('-').map(Number);
    if (!y || isNaN(m) || isNaN(day)) return null;
    return new Date(y, m - 1, day);
  }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function weekdayOfFirst(y, m) { return new Date(y, m, 1).getDay(); } // 0=周日
  function dateInRange(d, start, end) { return d >= start && d <= end; }
  function categoryMeta(key) { return CATEGORIES.find(function (c) { return c.key === key; }) || CATEGORIES[CATEGORIES.length - 1]; }

  // 活动相对「今天」的状态：已结束 / 进行中 / 即将开始
  function eventStatus(p) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = parseDate(p.startDate);
    const end = parseDate(p.endDate);
    if (!start || !end) return 'none';
    if (end < today) return 'past';
    if (start > today) return 'upcoming';
    return 'ongoing';
  }
  function hasPhotos(p) { return !!(p.images && p.images.length); }

  // ============================================================
  // 游客可见性配置
  // ============================================================
  function loadVisibility() {
    try {
      const r = JSON.parse(localStorage.getItem(VIS_KEY) || 'null');
      if (r && typeof r === 'object') {
        state.visibility = { calendar: !!r.calendar, monthly: !!r.monthly };
      }
    } catch (e) { /* ignore */ }
  }
  function saveVisibility() {
    localStorage.setItem(VIS_KEY, JSON.stringify(state.visibility));
    if (typeof pushServer === 'function') pushServer();
  }
  function tabVisible(v) {
    if (v === 'activity') return true;
    if (state.isLoggedIn) return true;          // 管理员始终可见全部视图
    return !!state.visibility[v];               // 游客受开关控制
  }

  // ============================================================
  // 节假日数据（默认 2026 中国官方假日办）
  // ============================================================
  function defaultHolidays(year) {
    if (year !== 2026) return [];
    return [
      { id: uid(), name: '元旦', startDate: '2026-01-01', endDate: '2026-01-03', type: 'holiday' },
      { id: uid(), name: '元旦调休', startDate: '2026-01-04', endDate: '2026-01-04', type: 'workday' },
      { id: uid(), name: '春节', startDate: '2026-02-15', endDate: '2026-02-23', type: 'holiday' },
      { id: uid(), name: '春节调休', startDate: '2026-02-14', endDate: '2026-02-14', type: 'workday' },
      { id: uid(), name: '春节调休', startDate: '2026-02-28', endDate: '2026-02-28', type: 'workday' },
      { id: uid(), name: '清明节', startDate: '2026-04-04', endDate: '2026-04-06', type: 'holiday' },
      { id: uid(), name: '劳动节', startDate: '2026-05-01', endDate: '2026-05-05', type: 'holiday' },
      { id: uid(), name: '劳动节调休', startDate: '2026-05-09', endDate: '2026-05-09', type: 'workday' },
      { id: uid(), name: '端午节', startDate: '2026-06-19', endDate: '2026-06-21', type: 'holiday' },
      { id: uid(), name: '中秋节', startDate: '2026-09-25', endDate: '2026-09-27', type: 'holiday' },
      { id: uid(), name: '国庆节', startDate: '2026-10-01', endDate: '2026-10-07', type: 'holiday' },
      { id: uid(), name: '国庆调休', startDate: '2026-09-20', endDate: '2026-09-20', type: 'workday' },
      { id: uid(), name: '国庆调休', startDate: '2026-10-10', endDate: '2026-10-10', type: 'workday' },
    ];
  }

  function loadHolidays() {
    try {
      const raw = JSON.parse(localStorage.getItem(HOLIDAY_KEY) || '[]');
      state.holidays = Array.isArray(raw) ? raw : [];
    } catch (e) { state.holidays = []; }
    if (!state.holidays.length && localStorage.getItem(HOLIDAY_SEED_FLAG) !== '1') {
      state.holidays = defaultHolidays(state.year);
      saveHolidays();
      localStorage.setItem(HOLIDAY_SEED_FLAG, '1');
    }
  }

  function saveHolidays() {
    localStorage.setItem(HOLIDAY_KEY, JSON.stringify(state.holidays));
    if (typeof pushServer === 'function') pushServer();
  }

  function holidayInfoForDate(dateStr) {
    const date = parseDate(dateStr);
    if (!date) return [];
    return state.holidays.filter(function (h) {
      const s = parseDate(h.startDate);
      const e = parseDate(h.endDate);
      return s && e && dateInRange(date, s, e);
    });
  }

  function holidayBadges(dateStr) {
    return holidayInfoForDate(dateStr).map(function (h) {
      const isStart = h.startDate === dateStr;
      const text = isStart ? h.name : (h.type === 'holiday' ? '休' : '班');
      const cls = h.type === 'holiday' ? 'holiday-rest' : 'holiday-work';
      return '<span class="holiday-chip ' + cls + '">' + esc(text) + '</span>';
    }).join('');
  }

  function hasHolidayType(dateStr, type) {
    return holidayInfoForDate(dateStr).some(function (h) { return h.type === type; });
  }

  // ============================================================
  // 项目数据加载 / 保存 / 迁移
  // ============================================================
  function normalizeProject(p) {
    const name = p.name || p.title || '';
    const start = p.startDate || p.date || '';
    const end = p.endDate || start;
    const cat = CATEGORIES.some(function (c) { return c.key === p.category; }) ? p.category : '';
    return {
      id: p.id || uid(),
      name: name,
      category: cat,
      keywords: p.keywords || '',
      startDate: start,
      endDate: end,
      description: p.description || p.desc || '',
      images: Array.isArray(p.images) ? p.images : [],
    };
  }

  function loadProjects() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      state.projects = Array.isArray(raw) ? raw.map(normalizeProject).filter(function (p) { return p.name && p.startDate; }) : [];
    } catch (e) {
      state.projects = [];
    }
  }

  function saveProjects() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
    pushServer();
  }

  // ============================================================
  // 服务器数据同步（服务器为唯一数据源，localStorage 仅作缓存）
  // ============================================================
  let syncReady = false;        // 初始同步完成前禁止推送，防止覆盖服务器数据
  let lastUpdatedAt = 0;

  function pushServer() {
    if (!syncReady) return;
    clearTimeout(pushServer._t);
    pushServer._t = setTimeout(function () {
      fetch('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projects: state.projects,
          holidays: state.holidays,
          visibility: state.visibility,
        }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.updatedAt) lastUpdatedAt = j.updatedAt;
      }).catch(function () { /* 网络异常：本地缓存仍在，下次保存会重试 */ });
    }, 250);
  }

  function sameProject(a, b) {
    return a.id === b.id || (a.name === b.name && a.startDate === b.startDate && a.endDate === b.endDate);
  }

  // 轻量提示条
  function showToast(msg) {
    let t = document.getElementById('appToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'appToast';
      t.className = 'app-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove('show'); }, 4000);
  }

  // 待合并备份：未登录时本地独有的活动先搁置在这里，绝不静默丢弃；
  // 管理员在本浏览器登录后自动合并上传。
  const PENDING_KEY = 'culture-calendar-pending-v1';
  function loadPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function savePending(list) {
    if (list && list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_KEY);
  }

  function applyServerData(data) {
    const sp = Array.isArray(data.projects)
      ? data.projects.map(normalizeProject).filter(function (p) { return p.name && p.startDate; })
      : [];
    // 本地独有活动 = 当前本地缓存 + 历史搁置备份 中服务器没有的（去重）
    const localAll = state.projects.concat(loadPending());
    const extra = [];
    localAll.forEach(function (lp) {
      if (!lp || !lp.name || !lp.startDate) return;
      if (sp.some(function (s) { return sameProject(s, lp); })) return;
      if (extra.some(function (e) { return sameProject(e, lp); })) return;
      extra.push(lp);
    });
    let merged = sp;
    let needPush = false;
    if (extra.length) {
      if (state.isLoggedIn) {
        // 管理员浏览器：本地独有活动合并上传，避免旧数据丢失
        merged = sp.concat(extra);
        needPush = true;
        savePending([]); // 已并入服务器数据，清空搁置备份
        showToast('已将本机 ' + extra.length + ' 条独有活动合并上传到服务器');
      } else {
        // 游客/未登录：不上传也不丢弃，先备份；待管理员登录后自动合并
        savePending(extra);
      }
    }
    state.projects = merged;
    if (Array.isArray(data.holidays) && data.holidays.length) state.holidays = data.holidays;
    if (data.visibility && typeof data.visibility === 'object') {
      state.visibility = { calendar: !!data.visibility.calendar, monthly: !!data.visibility.monthly };
    }
    if (data.updatedAt) lastUpdatedAt = data.updatedAt;
    // 刷新本地缓存
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
    localStorage.setItem(HOLIDAY_KEY, JSON.stringify(state.holidays));
    localStorage.setItem(VIS_KEY, JSON.stringify(state.visibility));
    return needPush;
  }

  function initialSync() {
    fetch('/api/data').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.exists && j.data) {
        const needPush = applyServerData(j.data);
        syncReady = true;
        if (needPush) pushServer();
      } else {
        // 服务器尚无数据：把本地数据（或种子数据）作为初始数据上传
        if (!state.projects.length) seedProjects();
        syncReady = true;
        pushServer();
      }
      renderTopBar();
      renderView();
    }).catch(function () {
      // 服务器不可达：退化为本地模式（只影响本机，不推送）
      if (!state.projects.length) seedProjects();
    });
  }

  // 轮询：其他人更新后 30 秒内自动刷新（编辑弹窗打开时跳过，避免打断输入）
  setInterval(function () {
    if (document.hidden || !syncReady) return;
    const overlay = document.querySelector('#modalOverlay');
    if (overlay && overlay.classList.contains('show')) return;
    fetch('/api/data').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.exists && j.data && j.data.updatedAt && j.data.updatedAt !== lastUpdatedAt) {
        applyServerData(j.data);
        renderTopBar();
        renderView();
      }
    }).catch(function () { /* ignore */ });
  }, 30000);

  function seedProjects() {
    if (localStorage.getItem(SEED_FLAG)) return;
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const sample = [
      {
        id: uid(), name: '年中总结大会', category: '会议', keywords: '半年度,复盘,表彰',
        startDate: fmtDate(new Date(y, m, 15)), endDate: fmtDate(new Date(y, m, 16)),
        description: '半年度业务复盘与表彰。', images: []
      },
      {
        id: uid(), name: '端午节庆祝', category: '节日', keywords: '端午,团建',
        startDate: fmtDate(new Date(y, 5, 10)), endDate: fmtDate(new Date(y, 5, 10)),
        description: '传统节日庆祝活动。', images: []
      },
    ];
    state.projects = sample;
    saveProjects();
    localStorage.setItem(SEED_FLAG, '1');
  }

  // ============================================================
  // 财年工具：FY N = N年7月 ~ N+1年6月（如 FY2026 = 2026-07 ~ 2027-06）
  // ============================================================
  function currentFY() {
    const d = new Date();
    return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  }
  // 财年内第 i 个月（0=7月 … 11=次年6月）→ 公历 { y, m }
  function fyCalendar(fy, i) {
    return i < 6 ? { y: fy, m: i + 6 } : { y: fy + 1, m: i - 6 };
  }
  function fyRangeText(fy) {
    return fy + '年7月 – ' + (fy + 1) + '年6月';
  }

  // 返回某月重叠的活动（按开始日期排序）
  function eventsInMonth(year, m) {
    const ms = new Date(year, m, 1);
    const me = new Date(year, m + 1, 0);
    return state.projects.filter(function (p) {
      const s = parseDate(p.startDate);
      const e = parseDate(p.endDate);
      return s && e && (dateInRange(s, ms, me) || dateInRange(e, ms, me) || (s <= ms && e >= me));
    }).sort(function (a, b) { return a.startDate.localeCompare(b.startDate); });
  }

  // ============================================================
  // 视图切换
  // ============================================================
  function setView(view) {
    if (!tabVisible(view)) view = 'activity';
    state.view = view;
    const pl = document.querySelector('.page-layout');
    if (pl) pl.classList.toggle('is-activity', view === 'activity');
    renderTopBar();
    if (view === 'calendar') renderCalendar('anim-view');
    else if (view === 'monthly') renderMonthly('anim-view');
    else renderActivity('anim-view');
  }
  function renderView() { setView(state.view); }

  function changeMonth(delta) {
    state.month += delta;
    if (state.month > 11) { state.month = 0; state.year++; }
    if (state.month < 0) { state.month = 11; state.year--; }
    renderCalendar(delta < 0 ? 'anim-left' : 'anim-right');
  }
  function goToday() {
    const t = new Date();
    state.year = t.getFullYear();
    state.month = t.getMonth();
    renderCalendar('anim-view');
  }

  // ============================================================
  // 顶部栏
  // ============================================================
  function renderTopBar() {
    const bar = document.getElementById('topBar');
    const tabs = [
      { key: 'activity', label: '活动' },
      { key: 'calendar', label: '日历' },
      { key: 'monthly', label: '月历' },
    ];
    const visibleTabs = tabs.filter(function (t) { return tabVisible(t.key); });
    // 仅当可见标签 >= 2 时才显示标签栏；游客默认仅「活动」单视图时隐藏，避免多余按钮
    const navHtml = visibleTabs.length >= 2
      ? '<nav class="header-nav">' + visibleTabs.map(function (t) {
          return '<button class="nav-tab ' + (state.view === t.key ? 'active' : '') + '" data-view="' + t.key + '">' + t.label + '</button>';
        }).join('') + '</nav>'
      : '';

    const right = state.isLoggedIn
      ? '<button class="btn btn-ghost btn-sm" id="btnSettings" title="显示设置">⚙</button>' +
        '<span class="admin-badge">管理模式</span><button class="btn btn-ghost" id="btnLogout">退出</button>'
      : '<button class="btn btn-primary" id="btnLogin">登录</button>';

    bar.innerHTML =
      '<div class="header-brand" id="brandHome">' +
        '<div class="brand-logo">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>' +
        '</div>' +
        '<div class="brand-text">' +
          '<div class="brand-title">EGO企业文化活动看板</div>' +
          '<div class="brand-subtitle">EGO CORPORATE CULTURE ACTIVITY BOARD</div>' +
        '</div>' +
      '</div>' +
      navHtml +
      '<div class="header-right">' + right + '</div>';

    bar.querySelectorAll('.nav-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { setView(btn.dataset.view); });
    });

    const loginBtn = document.getElementById('btnLogin');
    if (loginBtn) loginBtn.addEventListener('click', showLoginModal);

    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    const settingsBtn = document.getElementById('btnSettings');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

    document.getElementById('brandHome').addEventListener('click', function () { setView('activity'); });
  }

  // ============================================================
  // 年 / 月 二级选择菜单（所有视图共用）
  // ============================================================
  let datePickerEl = null;
  function rerenderCurrent() {
    if (state.view === 'calendar') renderCalendar('anim-view');
    else if (state.view === 'monthly') renderMonthly('anim-view');
    else renderActivity('anim-view');
  }
  function closeDatePicker() {
    if (datePickerEl) { datePickerEl.remove(); datePickerEl = null; }
    document.removeEventListener('keydown', onPickerKey, true);
    document.removeEventListener('click', onPickerOutside, true);
  }
  function onPickerKey(e) { if (e.key === 'Escape') closeDatePicker(); }
  function onPickerOutside(e) {
    if (datePickerEl && !datePickerEl.contains(e.target) &&
        !e.target.closest('.yr-pill') && !e.target.closest('.mo-pill')) {
      closeDatePicker();
    }
  }
  function openDatePicker(initialMode, anchorEl) {
    closeDatePicker();
    let target;
    if (state.view === 'calendar') {
      target = {
        hasMonth: true,
        getYear: function () { return state.year; },
        getMonth: function () { return state.month; },
        apply: function (y, m) { state.year = y; if (m != null) state.month = m; rerenderCurrent(); },
      };
    } else if (state.view === 'monthly') {
      target = {
        hasMonth: false,
        getYear: function () { return state.monthlyYear; },
        apply: function (y) { state.monthlyYear = y; rerenderCurrent(); },
      };
    } else {
      target = {
        hasMonth: false,
        fy: true, // 财年模式：FY N = N年7月~N+1年6月
        getYear: function () { return state.activityYear; },
        apply: function (y) { state.activityYear = y; rerenderCurrent(); },
      };
    }

    let mode = initialMode || 'year';
    let dispYear = target.getYear();
    const now = new Date();
    const curY = now.getFullYear(), curM = now.getMonth();

    const el = document.createElement('div');
    el.className = 'date-picker';
    document.body.appendChild(el);
    datePickerEl = el;

    function render() {
      if (mode === 'year') {
        const isFY = !!target.fy;
        const nowMark = isFY ? currentFY() : curY; // 财年模式高亮当前财年
        const start = Math.floor(dispYear / 10) * 10;
        const years = [];
        for (let i = 0; i < 12; i++) years.push(start + i);
        el.innerHTML =
          '<div class="dp-header">' +
            '<button class="dp-nav" data-step="-10" title="上一页">‹</button>' +
            '<div class="dp-range">' + (isFY ? 'FY' + years[0] + ' – FY' + years[years.length - 1] : years[0] + ' – ' + years[years.length - 1]) + '</div>' +
            '<button class="dp-nav" data-step="10" title="下一页">›</button>' +
          '</div>' +
          '<div class="dp-year-grid' + (isFY ? ' dp-fy' : '') + '">' +
            years.map(function (y) {
              const cls = 'dp-year' + (y === target.getYear() ? ' dp-sel' : '') + (y === nowMark ? ' dp-now' : '');
              const lbl = isFY ? 'FY' + y : y;
              const tip = isFY ? ' title="' + y + '年7月 – ' + (y + 1) + '年6月"' : '';
              return '<button class="' + cls + '" data-year="' + y + '"' + tip + '>' + lbl + '</button>';
            }).join('') +
          '</div>' +
          (isFY ? '<div class="dp-fy-hint">财年 FY = 当年7月 至 次年6月</div>' : '');
      } else {
        const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        el.innerHTML =
          '<div class="dp-header">' +
            '<button class="dp-nav" data-step="-1" title="上一年">‹</button>' +
            '<button class="dp-year-toggle" data-act="toYear">' + dispYear + '年 ▴</button>' +
            '<button class="dp-nav" data-step="1" title="下一年">›</button>' +
            '<button class="dp-up" data-act="toYear" title="选择年份">↑</button>' +
          '</div>' +
          '<div class="dp-month-grid">' +
            MONTHS.map(function (lbl, i) {
              const cls = 'dp-month' +
                (dispYear === target.getYear() && i === target.getMonth() ? ' dp-sel' : '') +
                (dispYear === curY && i === curM ? ' dp-now' : '');
              return '<button class="' + cls + '" data-month="' + i + '">' + lbl + '</button>';
            }).join('') +
          '</div>';
      }

      el.querySelectorAll('[data-step]').forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); dispYear += parseInt(b.dataset.step, 10); render(); });
      });
      el.querySelectorAll('[data-act="toYear"]').forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); mode = 'year'; render(); });
      });
      el.querySelectorAll('[data-year]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          const y = parseInt(b.dataset.year, 10);
          if (target.hasMonth) { target.apply(y, target.getMonth()); mode = 'month'; dispYear = y; render(); }
          else { target.apply(y); closeDatePicker(); }
        });
      });
      el.querySelectorAll('[data-month]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          target.apply(dispYear, parseInt(b.dataset.month, 10));
          closeDatePicker();
        });
      });
    }
    render();

    // 定位到触发按钮下方
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      el.style.top = (r.bottom + 8 + window.scrollY) + 'px';
      let left = r.left + window.scrollX;
      const maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 12;
      if (left > maxLeft) left = maxLeft;
      if (left < window.scrollX + 8) left = window.scrollX + 8;
      el.style.left = left + 'px';
      const arrowX = (r.left + r.width / 2) - left;
      el.style.setProperty('--arrow-x', arrowX + 'px');
    } else {
      el.style.top = '80px';
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
    }

    // 同步附加关闭监听：打开点击处于捕获阶段之后，文档级捕获监听此刻早已执行过
    // （当时 datePickerEl 尚不存在，等于空操作），故不会误关本次打开的弹层。
    document.addEventListener('keydown', onPickerKey, true);
    document.addEventListener('click', onPickerOutside, true);
  }

  // ============================================================
  // 日历视图
  // ============================================================
  function renderCalendar(anim) {
    const app = $('#app');
    app.innerHTML = '';

    const view = document.createElement('div');
    view.className = 'calendar-view' + (anim ? ' ' + anim : '');

    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML =
      '<div class="calendar-title">' +
        '<button class="yr-pill" id="yrPill">' + state.year + '年<span class="caret"></span></button>' +
        '<button class="mo-pill" id="moPill">' + (state.month + 1) + '月<span class="caret"></span></button>' +
      '</div>' +
      '<div class="calendar-controls">' +
        (state.isLoggedIn ? '<button class="btn btn-ghost btn-sm" id="btnHolidays">节假日管理</button>' : '') +
        '<button class="btn-icon" id="btnPrevMonth" title="上月">‹</button>' +
        '<button class="btn btn-ghost" id="btnToday">当前月</button>' +
        '<button class="btn-icon" id="btnNextMonth" title="下月">›</button>' +
      '</div>';
    view.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    weekdays.forEach(function (d, i) {
      const cell = document.createElement('div');
      cell.className = 'weekday-cell' + (i === 0 || i === 6 ? ' weekend' : '');
      cell.textContent = d;
      grid.appendChild(cell);
    });

    const firstDow = weekdayOfFirst(state.year, state.month);
    const totalDays = daysInMonth(state.year, state.month);
    const prevDays = daysInMonth(state.year, state.month - 1);
    const today = new Date();
    let dayCount = 1;
    let nextMonthDay = 1;

    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 7; c++) {
        const idx = r * 7 + c;
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        let dateStr = null;
        let displayDay = '';

        if (idx < firstDow) {
          displayDay = prevDays - (firstDow - idx - 1);
          cell.classList.add('other-month');
        } else if (dayCount <= totalDays) {
          displayDay = dayCount;
          dateStr = `${state.year}-${pad2(state.month + 1)}-${pad2(dayCount)}`;
          cell.classList.add('current-month');
          if (today.getFullYear() === state.year && today.getMonth() === state.month && today.getDate() === dayCount) {
            cell.classList.add('today');
          }
          dayCount++;
        } else {
          displayDay = nextMonthDay++;
          cell.classList.add('other-month');
        }

        const dayNum = document.createElement('div');
        dayNum.className = 'day-number';
        dayNum.textContent = displayDay;
        cell.appendChild(dayNum);

        if (dateStr) {
          const date = parseDate(dateStr);
          const covering = state.projects.filter(function (proj) {
            const s = parseDate(proj.startDate);
            const e = parseDate(proj.endDate);
            return s && e && dateInRange(date, s, e);
          });

          const chips = document.createElement('div');
          chips.className = 'day-chips';
          const MAX_VISIBLE = 3;
          covering.slice(0, MAX_VISIBLE - 1).forEach(function (proj) {
            chips.appendChild(buildChip(proj));
          });
          if (covering.length > MAX_VISIBLE - 1) {
            const more = document.createElement('div');
            more.className = 'more-chip';
            more.textContent = '+' + (covering.length - (MAX_VISIBLE - 1)) + ' 更多';
            more.title = '查看全部 ' + covering.length + ' 个活动';
            more.addEventListener('click', function (e) { e.stopPropagation(); showDayList(dateStr); });
            chips.appendChild(more);
          }
          cell.appendChild(chips);

          if (state.isLoggedIn) {
            const add = document.createElement('button');
            add.className = 'day-add-btn';
            add.textContent = '+';
            add.title = '新增活动';
            add.addEventListener('click', function (e) { e.stopPropagation(); openForm(null, dateStr); });
            cell.appendChild(add);
          }

          const hBadges = holidayBadges(dateStr);
          if (hBadges) {
            const hb = document.createElement('div');
            hb.className = 'holiday-badges';
            hb.innerHTML = hBadges;
            cell.appendChild(hb);
          }

          cell.addEventListener('click', function () { onDayClick(dateStr); });
        }

        grid.appendChild(cell);
      }
    }

    view.appendChild(grid);
    app.appendChild(view);

    document.getElementById('btnPrevMonth').addEventListener('click', function () { changeMonth(-1); });
    document.getElementById('btnNextMonth').addEventListener('click', function () { changeMonth(1); });
    document.getElementById('btnToday').addEventListener('click', goToday);
    document.getElementById('yrPill').addEventListener('click', function (e) { e.stopPropagation(); openDatePicker('year', this); });
    document.getElementById('moPill').addEventListener('click', function (e) { e.stopPropagation(); openDatePicker('month', this); });

    const holidayBtn = document.getElementById('btnHolidays');
    if (holidayBtn) holidayBtn.addEventListener('click', openHolidayManager);

  }

  // ============================================================
  // 月历视图（12 个月小图）
  // ============================================================
  function renderMonthly(anim) {
    const app = $('#app');
    app.innerHTML = '';

    const view = document.createElement('div');
    view.className = 'monthly-view' + (anim ? ' ' + anim : '');

    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML =
      '<div class="calendar-title">' +
        '<button class="yr-pill" id="yrPill">' + state.monthlyYear + '年<span class="caret"></span></button>' +
      '</div>' +
      '<div class="calendar-controls">' +
        (state.isLoggedIn ? '<button class="btn btn-ghost btn-sm" id="btnHolidays">节假日管理</button>' : '') +
        '<button class="btn-icon" id="btnPrevYear" title="上一年">‹</button>' +
        '<button class="btn btn-ghost" id="btnCurrentYear">今年</button>' +
        '<button class="btn-icon" id="btnNextYear" title="下一年">›</button>' +
      '</div>';
    view.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'monthly-grid';

    for (let m = 0; m < 12; m++) {
      const mini = document.createElement('div');
      mini.className = 'mini-month';
      mini.innerHTML = '<div class="mini-month-title">' + (m + 1) + '月</div>';
      const miniGrid = document.createElement('div');
      miniGrid.className = 'mini-grid';
      ['日', '一', '二', '三', '四', '五', '六'].forEach(function (d) {
        const th = document.createElement('div');
        th.className = 'mini-weekday';
        th.textContent = d;
        miniGrid.appendChild(th);
      });

      const firstDow = weekdayOfFirst(state.monthlyYear, m);
      const totalDays = daysInMonth(state.monthlyYear, m);
      const prevDays = daysInMonth(state.monthlyYear, m - 1);
      let dayCount = 1;
      let nextMonthDay = 1;
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
          const idx = r * 7 + c;
          const cell = document.createElement('div');
          cell.className = 'mini-day';
          if (idx < firstDow) {
            cell.classList.add('other-month');
            cell.textContent = prevDays - (firstDow - idx - 1);
          } else if (dayCount <= totalDays) {
            cell.textContent = dayCount;
            const dateStr = `${state.monthlyYear}-${pad2(m + 1)}-${pad2(dayCount)}`;
            const date = parseDate(dateStr);
            const hasEvent = state.projects.some(function (proj) {
              const s = parseDate(proj.startDate);
              const e = parseDate(proj.endDate);
              return s && e && dateInRange(date, s, e);
            });
            if (hasEvent) cell.classList.add('has-event');
            if (hasHolidayType(dateStr, 'holiday')) cell.classList.add('holiday-rest');
            else if (hasHolidayType(dateStr, 'workday')) cell.classList.add('holiday-work');
            if (state.isLoggedIn) {
              const ab = document.createElement('button');
              ab.className = 'mini-add';
              ab.textContent = '+';
              ab.title = '新增活动';
              ab.addEventListener('click', function (e) { e.stopPropagation(); openForm(null, dateStr); });
              cell.appendChild(ab);
            }
            dayCount++;
          } else {
            cell.classList.add('other-month');
            cell.textContent = nextMonthDay++;
          }
          miniGrid.appendChild(cell);
        }
      }
      mini.appendChild(miniGrid);
      mini.addEventListener('click', function () {
        state.year = state.monthlyYear;
        state.month = m;
        setView('calendar');
      });
      grid.appendChild(mini);
    }

    view.appendChild(grid);
    app.appendChild(view);

    document.getElementById('btnPrevYear').addEventListener('click', function () { state.monthlyYear--; renderMonthly('anim-left'); });
    document.getElementById('btnNextYear').addEventListener('click', function () { state.monthlyYear++; renderMonthly('anim-right'); });
    document.getElementById('btnCurrentYear').addEventListener('click', function () { state.monthlyYear = new Date().getFullYear(); renderMonthly('anim-view'); });
    document.getElementById('yrPill').addEventListener('click', function (e) { e.stopPropagation(); openDatePicker('year', this); });

    const holidayBtn = document.getElementById('btnHolidays');
    if (holidayBtn) holidayBtn.addEventListener('click', openHolidayManager);

  }

  // ============================================================
  // 活动视图（6×2 月历卡片，卡片内显示活动而非日期）
  // ============================================================
  function buildActivityCard(p) {
    const meta = categoryMeta(p.category);
    const status = eventStatus(p);
    const card = document.createElement('div');
    card.className = 'act-card act-card--' + status;
    card.style.setProperty('--cat', meta.color);
    let right = '';
    if (hasPhotos(p)) right += '<span class="act-photo" title="含活动图片">📷</span>';
    if (status === 'past') right += '<span class="act-done" title="已结束">✓</span>';
    else if (status === 'ongoing') right += '<span class="act-status act-status--ongoing">进行中</span>';
    card.innerHTML =
      '<div class="act-card-name">' + esc(p.name) + '</div>' +
      (right ? '<div class="act-card-right">' + right + '</div>' : '');
    card.addEventListener('click', function () { onProjectClick(p); });
    return card;
  }

  function renderActivity(anim) {
    const app = $('#app');
    app.innerHTML = '';

    const view = document.createElement('div');
    view.className = 'activity-view' + (anim ? ' ' + anim : '');

    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML =
      '<div class="calendar-title">' +
        '<button class="yr-pill" id="yrPill">FY' + state.activityYear + '<span class="caret"></span></button>' +
        '<span class="fy-range">' + fyRangeText(state.activityYear) + '</span>' +
      '</div>' +
      '<div class="calendar-controls">' +
        (state.isLoggedIn ? '<button class="btn btn-ghost btn-sm" id="btnHolidays">节假日管理</button>' : '') +
        '<button class="btn-icon" id="btnPrevAY" title="上一财年">‹</button>' +
        '<button class="btn btn-ghost" id="btnCurAY">本财年</button>' +
        '<button class="btn-icon" id="btnNextAY" title="下一财年">›</button>' +
      '</div>';
    view.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'activity-grid';
    for (let i = 0; i < 12; i++) {
      const c = fyCalendar(state.activityYear, i); // 财年第 i 月 → 公历年月
      const card = document.createElement('div');
      card.className = 'act-month';
      card.dataset.m = i;
      card.innerHTML = '<div class="act-month-title">' + c.y + '年 ' + (c.m + 1) + '月</div>';
      const list = document.createElement('div');
      list.className = 'act-cards';
      const evs = eventsInMonth(c.y, c.m);
      if (!evs.length) {
        list.innerHTML = '<div class="act-empty">暂无活动</div>';
      } else {
        const MAX = 4;
        evs.slice(0, MAX).forEach(function (p) { list.appendChild(buildActivityCard(p)); });
        if (evs.length > MAX) {
          const more = document.createElement('div');
          more.className = 'more-chip';
          more.textContent = '+ ' + (evs.length - MAX) + ' 更多';
          more.addEventListener('click', function () { showMonthList(c.y, c.m); });
          list.appendChild(more);
        }
      }
      card.appendChild(list);
      grid.appendChild(card);
    }
    view.appendChild(grid);
    view.appendChild(buildTimeline());
    app.appendChild(view);

    document.getElementById('btnPrevAY').addEventListener('click', function () { state.activityYear--; renderActivity('anim-left'); });
    document.getElementById('btnNextAY').addEventListener('click', function () { state.activityYear++; renderActivity('anim-right'); });
    document.getElementById('btnCurAY').addEventListener('click', function () { state.activityYear = currentFY(); renderActivity('anim-view'); });
    document.getElementById('yrPill').addEventListener('click', function (e) { e.stopPropagation(); openDatePicker('year', this); });

    const holidayBtn = document.getElementById('btnHolidays');
    if (holidayBtn) holidayBtn.addEventListener('click', openHolidayManager);

  }

  // ============================================================
  // 活动视图底部时间轴 —— Annual Timeline 组件（tlx）
  // 玻璃球节点 + 渐变发光轨道 + 毛玻璃浮层，仅重构 UI，不改数据接口
  // ============================================================
  const TLX_MONTHS_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  let tlxHideTimer = null;

  function tlxStatusText(s) {
    return s === 'past' ? '已完成' : (s === 'ongoing' ? '进行中' : '待开始');
  }

  // 单例浮层（挂 body 上，避免被滚动容器裁剪）
  function tlxPopEl() {
    let pop = document.getElementById('tlxPop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'tlxPop';
      pop.className = 'tlx-pop';
      document.body.appendChild(pop);
      pop.addEventListener('mouseenter', function () { if (tlxHideTimer) clearTimeout(tlxHideTimer); });
      pop.addEventListener('mouseleave', function () { tlxHidePop(); });
      window.addEventListener('scroll', function () { tlxHidePop(true); }, true);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') tlxHidePop(true); });
      document.addEventListener('click', function (e) {
        if (!e.target.closest || (!e.target.closest('#tlxPop') && !e.target.closest('.tlx-node'))) tlxHidePop(true);
      });
    }
    return pop;
  }

  function tlxHidePop(immediate) {
    const pop = document.getElementById('tlxPop');
    if (!pop) return;
    if (tlxHideTimer) clearTimeout(tlxHideTimer);
    if (immediate) { pop.classList.remove('show'); return; }
    tlxHideTimer = window.setTimeout(function () { pop.classList.remove('show'); }, 140);
  }

  function tlxShowPop(node, m) {
    const c = fyCalendar(state.activityYear, m); // m 为财年内序号
    const evs = eventsInMonth(c.y, c.m);
    if (!evs.length) { tlxHidePop(true); return; }
    if (tlxHideTimer) clearTimeout(tlxHideTimer);
    const pop = tlxPopEl();
    pop.dataset.m = String(m);
    pop.innerHTML =
      '<div class="tlx-pop-head"><b>' + c.y + '年' + (c.m + 1) + '月</b><span>' + evs.length + ' 项活动</span></div>' +
      '<div class="tlx-pop-list">' + evs.map(function (p) {
        const st = eventStatus(p);
        const range = p.startDate === p.endDate ? p.startDate.slice(5) : p.startDate.slice(5) + ' ~ ' + p.endDate.slice(5);
        return '<div class="tlx-pop-item" data-id="' + p.id + '">' +
          '<div class="tpi-line1">' + (st === 'past' ? '<i>✓</i>' : '') + '<span class="tpi-name">' + esc(p.name) + '</span>' +
          '<span class="tpi-status s-' + st + '">' + tlxStatusText(st) + '</span></div>' +
          '<div class="tpi-line2">' + esc(range) + (p.category ? ' · ' + esc(p.category) : '') + '</div>' +
          '</div>';
      }).join('') + '</div>';
    pop.querySelectorAll('.tlx-pop-item').forEach(function (it) {
      it.addEventListener('click', function () {
        const proj = state.projects.find(function (x) { return x.id === it.dataset.id; });
        if (!proj) return;
        tlxHidePop(true);
        onProjectClick(proj);
      });
    });
    // 自动寻找最佳位置：优先节点上方，空间不足放下方；水平方向夹取在视口内
    const r = node.getBoundingClientRect();
    const pw = pop.offsetWidth || 280;
    const ph = pop.offsetHeight;
    const vw = window.innerWidth;
    const left = Math.min(Math.max(r.left + r.width / 2 - pw / 2, 12), vw - pw - 12);
    const above = r.top - ph - 16 > 70;
    const top = above ? r.top - ph - 14 : r.bottom + 14;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.setProperty('--ax', (r.left + r.width / 2 - left) + 'px');
    pop.classList.toggle('pos-above', above);
    pop.classList.toggle('pos-below', !above);
    pop.classList.add('show');
  }

  // 点击节点：平滑滚动到上方对应月份卡片并短暂高亮
  function tlxScrollToMonth(m) {
    const target = document.querySelector('.act-month[data-m="' + m + '"]');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('act-month--flash');
    window.setTimeout(function () { target.classList.remove('act-month--flash'); }, 1500);
  }

  function buildTimeline() {
    const now = new Date();
    const isCurFY = state.activityYear === currentFY();
    // 当前公历月份在本财年内的序号（7月=0 … 次年6月=11）
    const curFyIdx = now.getMonth() >= 6 ? now.getMonth() - 6 : now.getMonth() + 6;
    const coarse = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);

    const wrap = document.createElement('section');
    wrap.className = 'tlx';
    wrap.setAttribute('aria-label', 'FY' + state.activityYear + ' 财年活动时间轴');

    const months = [];
    let total = 0;
    for (let i = 0; i < 12; i++) {
      const c = fyCalendar(state.activityYear, i);
      const evs = eventsInMonth(c.y, c.m);
      months.push(evs);
      total += evs.length;
    }

    const head = document.createElement('div');
    head.className = 'tlx-head';
    head.innerHTML =
      '<div class="tlx-title"><span class="tlx-year">FY' + state.activityYear + '</span>' +
      '<span class="tlx-label">Fiscal Year Timeline · ' + fyRangeText(state.activityYear) + '</span></div>' +
      '<span class="tlx-total">' + total + ' Activities</span>';
    wrap.appendChild(head);

    const scroll = document.createElement('div');
    scroll.className = 'tlx-scroll';
    const track = document.createElement('div');
    track.className = 'tlx-track';
    const rail = document.createElement('div');
    rail.className = 'tlx-rail';
    rail.innerHTML = '<i class="tlx-rail-glow"></i><i class="tlx-rail-fill"></i>';
    track.appendChild(rail);

    const nodes = document.createElement('div');
    nodes.className = 'tlx-nodes';

    months.forEach(function (evs, m) {
      const c = fyCalendar(state.activityYear, m);
      const n = evs.length;
      const tier = n === 0 ? 0 : (n <= 2 ? 1 : (n <= 5 ? 2 : 3));
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'tlx-node t' + tier + (isCurFY && m === curFyIdx ? ' is-current' : '');
      node.style.setProperty('--i', m);
      node.dataset.m = m;
      node.setAttribute('aria-label', c.y + '年' + (c.m + 1) + '月，' + n + ' 项活动');

      let listHtml = '';
      let listCount = 0;
      if (n) {
        const shown = evs.slice(0, 2);
        listCount = shown.length + (n > 2 ? 1 : 0);
        listHtml = shown.map(function (p) {
          const done = eventStatus(p) === 'past';
          return '<span class="tlx-item' + (done ? ' done' : '') + '">' + (done ? '<i>✓</i>' : '') + esc(p.name) + '</span>';
        }).join('');
        if (n > 2) listHtml += '<span class="tlx-more">+' + (n - 2) + ' Activities</span>';
      }

      node.innerHTML =
        '<span class="tlx-mon">' + TLX_MONTHS_EN[c.m] + '</span>' +
        '<span class="tlx-orbwrap"><span class="tlx-ring"></span><span class="tlx-orb">' + (n || '') + '</span></span>' +
        '<span class="tlx-list' + (listCount > 1 ? ' multi' : '') + '">' + listHtml + '</span>';

      if (!coarse) {
        node.addEventListener('mouseenter', function () { tlxShowPop(node, m); });
        node.addEventListener('mouseleave', function () { tlxHidePop(); });
      }
      node.addEventListener('focus', function () {
        if (node.matches && node.matches(':focus-visible')) tlxShowPop(node, m);
      });
      node.addEventListener('blur', function () { tlxHidePop(); });
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        const pop = document.getElementById('tlxPop');
        const shownHere = pop && pop.classList.contains('show') && pop.dataset.m === String(m);
        if (coarse && n && !shownHere) { tlxShowPop(node, m); return; } // 移动端：第一次点按显示浮层
        tlxHidePop(true);
        tlxScrollToMonth(m);
      });
      nodes.appendChild(node);
    });

    // 键盘 ←/→ 导航
    nodes.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const all = Array.prototype.slice.call(nodes.querySelectorAll('.tlx-node'));
      const idx = all.indexOf(document.activeElement);
      const next = e.key === 'ArrowRight' ? Math.min(idx + 1, all.length - 1) : Math.max(idx - 1, 0);
      all[next].focus();
    });

    track.appendChild(nodes);
    scroll.appendChild(track);
    wrap.appendChild(scroll);
    return wrap;
  }

  function showMonthList(year, m) {
    const evs = eventsInMonth(year, m);
    const title = year + '年 ' + (m + 1) + '月 活动（' + evs.length + '）';
    let body;
    if (!evs.length) {
      body = '<div class="muted">该月暂无活动。</div>';
    } else {
      body = '<div class="daylist">' + evs.map(function (p) {
        const meta = categoryMeta(p.category);
        const range = p.startDate === p.endDate ? p.startDate : p.startDate + ' ~ ' + p.endDate;
        return '<div class="daylist-item" data-id="' + p.id + '">' +
          '<div class="timeline-dot" style="background:' + meta.color + '"></div>' +
          '<div class="timeline-body"><div class="timeline-title">' + esc(p.name) + '</div>' +
          '<div class="timeline-meta">' + esc(range) + (p.category ? ' · ' + esc(p.category) : '') + '</div></div>' +
          '</div>';
      }).join('') + '</div>';
    }
    showModal(title, body);
    document.querySelectorAll('.daylist-item').forEach(function (it) {
      it.addEventListener('click', function () {
        const proj = state.projects.find(function (x) { return x.id === it.dataset.id; });
        if (!proj) return;
        closeModal();
        if (state.isLoggedIn) openForm(proj);
        else showGuestDetail(proj);
      });
    });
  }

  // ============================================================
  // 交互：点击日期 / 活动
  // ============================================================
  function onDayClick(dateStr) {
    if (state.isLoggedIn) openForm(null, dateStr);
    else showGuestEmpty(dateStr);
  }

  function onProjectClick(proj) {
    if (state.isLoggedIn) openForm(proj);
    else showGuestDetail(proj);
  }

  function showGuestEmpty(dateStr) {
    showModal(
      '活动详情',
      '<div class="guest-detail"><div class="gd-name">暂无活动</div><div class="gd-row"><span class="gd-label">日期</span><span class="gd-value">' + esc(dateStr) + '</span></div><div class="muted">该日期暂无活动安排。</div></div>'
    );
  }

  function buildChip(proj) {
    const meta = categoryMeta(proj.category);
    const chip = document.createElement('div');
    chip.className = 'event-chip';
    chip.style.backgroundColor = hexToRgba(meta.bg, 0.62);
    chip.style.color = meta.color;
    chip.style.borderLeft = '3px solid ' + meta.color;
    chip.style.borderColor = hexToRgba(meta.color, 0.3);
    const photo = hasPhotos(proj) ? ' <span class="chip-photo" title="含活动图片">📷</span>' : '';
    chip.innerHTML = esc(proj.name) + photo;
    chip.title = proj.name + (hasPhotos(proj) ? '（含图片）' : '');
    chip.addEventListener('click', function (e) { e.stopPropagation(); onProjectClick(proj); });
    return chip;
  }

  function showDayList(dateStr) {
    const list = state.projects.filter(function (proj) {
      const s = parseDate(proj.startDate);
      const e = parseDate(proj.endDate);
      return s && e && dateInRange(parseDate(dateStr), s, e);
    }).sort(function (a, b) { return a.startDate.localeCompare(b.startDate); });

    const title = dateStr + ' 活动（' + list.length + '）';
    let body = '';
    if (state.isLoggedIn) {
      body += '<div class="daylist-action"><button class="btn btn-primary btn-sm" id="dlAdd">+ 新增活动</button></div>';
    }
    if (!list.length) {
      body += '<div class="muted">该日期暂无活动。</div>';
    } else {
      body += '<div class="daylist">' + list.map(function (p) {
        const meta = categoryMeta(p.category);
        const range = p.startDate === p.endDate ? p.startDate : p.startDate + ' ~ ' + p.endDate;
        return '<div class="daylist-item" data-id="' + p.id + '">' +
          '<div class="timeline-dot" style="background:' + meta.color + '"></div>' +
          '<div class="timeline-body"><div class="timeline-title">' + esc(p.name) + '</div>' +
          '<div class="timeline-meta">' + esc(range) + (p.category ? ' · ' + esc(p.category) : '') + '</div></div>' +
          '</div>';
      }).join('') + '</div>';
    }
    showModal(title, body);

    const dlAdd = document.getElementById('dlAdd');
    if (dlAdd) dlAdd.addEventListener('click', function () { closeModal(); openForm(null, dateStr); });
    document.querySelectorAll('.daylist-item').forEach(function (it) {
      it.addEventListener('click', function () {
        const proj = state.projects.find(function (x) { return x.id === it.dataset.id; });
        if (!proj) return;
        closeModal();
        if (state.isLoggedIn) openForm(proj);
        else showGuestDetail(proj);
      });
    });
  }

  // ============================================================
  // 弹窗底层
  // ============================================================
  function showModal(title, bodyHtml, opts) {
    const overlay = $('#modalOverlay');
    const card = $('#modalCard');
    card.classList.toggle('modal-card--wide', !!(opts && opts.wide));
    card.innerHTML =
      '<div class="modal-header"><h3>' + esc(title) + '</h3><button class="modal-close" id="modalClose">×</button></div>' + bodyHtml;
    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    document.getElementById('modalClose').addEventListener('click', closeModal);
  }

  function closeModal() {
    const overlay = $('#modalOverlay');
    overlay.classList.remove('show');
    state.editingId = null;
    window.setTimeout(function () {
      if (!overlay.classList.contains('show')) {
        overlay.classList.add('hidden');
        $('#modalCard').innerHTML = '';
      }
    }, 300);
  }

  $('#modalOverlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  // ============================================================
  // 游客详情卡（含 Justified 图片墙 + 灯箱）
  // ============================================================
  function showGuestDetail(proj) {
    const meta = categoryMeta(proj.category);
    const range = proj.startDate === proj.endDate ? proj.startDate : proj.startDate + ' ~ ' + proj.endDate;
    let html =
      '<div class="guest-detail">' +
        '<div class="gd-name">' + esc(proj.name) + '</div>' +
        '<div class="gd-row"><span class="gd-label">分类</span><span class="cat-pill" style="background:' + meta.bg + ';color:' + meta.color + ';border-color:' + meta.color + '">' + (proj.category || '未分类') + '</span></div>' +
        '<div class="gd-row"><span class="gd-label">起止日期</span><span class="gd-value">' + esc(range) + '</span></div>' +
        '<div class="gd-row"><span class="gd-label">项目简介</span><div class="gd-desc">' + esc(proj.description || '暂无') + '</div></div>';

    if (proj.images && proj.images.length) {
      html += '<div class="gd-row"><span class="gd-label">图片墙</span><div class="jf-gallery" id="jfGallery"></div></div>';
    }
    html += '</div>';
    showModal('活动详情', html);

    if (proj.images && proj.images.length) {
      const gallery = document.getElementById('jfGallery');
      renderJustified(gallery, proj.images, 150);
      bindLightbox(gallery, proj.images);
    }
  }

  // ============================================================
  // 图片：上传 / 删除 / Justified 布局 / 灯箱
  // ============================================================
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('read failed')); };
      r.readAsDataURL(file);
    });
  }
  async function uploadImage(activityId, file) {
    const data = await readFileAsDataURL(file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activityId: activityId, name: file.name, data: data }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    return j.url;
  }
  async function deleteImage(activityId, name) {
    await fetch('/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activityId: activityId, name: name }),
    });
  }

  // Justified Layout（Google Photos / Picasa 风格）
  function renderJustified(container, urls, rowHeight) {
    container.innerHTML = '';
    urls.forEach(function (u) {
      const img = document.createElement('img');
      img.className = 'jf-item';
      img.src = u;
      img.loading = 'lazy';
      img.alt = '';
      img.onload = function () { img._ratio = img.naturalWidth / img.naturalHeight || 1.4; layoutJustified(container, rowHeight); };
      img.onerror = function () { img._ratio = 1.4; layoutJustified(container, rowHeight); };
      container.appendChild(img);
    });
    window.setTimeout(function () { layoutJustified(container, rowHeight); }, 60);
  }
  function layoutJustified(container, rowHeight) {
    const items = Array.from(container.children);
    if (!items.length) return;
    const W = container.clientWidth || 460;
    const gap = 8;
    let row = [];
    let ratioSum = 0;
    items.forEach(function (it) {
      const ratio = it._ratio || 1.4;
      row.push(it);
      ratioSum += ratio;
      const projected = ratioSum * rowHeight + (row.length - 1) * gap;
      if (projected >= W - 1 || row.length === items.length) {
        const gaps = (row.length - 1) * gap;
        const avail = W - gaps;
        const h = avail / ratioSum;
        row.forEach(function (el) { el.style.height = h + 'px'; el.style.width = (h * (el._ratio || 1.4)) + 'px'; });
        row = [];
        ratioSum = 0;
      }
    });
  }

  let lightboxUrls = [];
  function bindLightbox(container, urls) {
    lightboxUrls = urls;
    Array.from(container.children).forEach(function (img, i) {
      img.addEventListener('click', function () { openLightbox(i); });
    });
  }
  function openLightbox(index) {
    let lb = document.getElementById('lightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'lightbox';
      lb.className = 'lightbox hidden';
      lb.innerHTML =
        '<button class="lb-close" id="lbClose">×</button>' +
        '<button class="lb-nav lb-prev" id="lbPrev">‹</button>' +
        '<img class="lb-img" id="lbImg" alt="">' +
        '<button class="lb-nav lb-next" id="lbNext">›</button>' +
        '<div class="lb-count" id="lbCount"></div>';
      document.body.appendChild(lb);
      document.getElementById('lbClose').addEventListener('click', closeLightbox);
      document.getElementById('lbPrev').addEventListener('click', function () { navLightbox(-1); });
      document.getElementById('lbNext').addEventListener('click', function () { navLightbox(1); });
      lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });
      document.addEventListener('keydown', lbKey);
    }
    lb._index = index;
    lb.classList.remove('hidden');
    updateLightbox();
  }
  function updateLightbox() {
    const lb = document.getElementById('lightbox');
    const i = lb._index;
    document.getElementById('lbImg').src = lightboxUrls[i] || '';
    document.getElementById('lbCount').textContent = (i + 1) + ' / ' + lightboxUrls.length;
  }
  function navLightbox(d) {
    const lb = document.getElementById('lightbox');
    lb._index = (lb._index + d + lightboxUrls.length) % lightboxUrls.length;
    updateLightbox();
  }
  function closeLightbox() { document.getElementById('lightbox').classList.add('hidden'); }
  function lbKey(e) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') navLightbox(-1);
    else if (e.key === 'ArrowRight') navLightbox(1);
  }

  // ============================================================
  // 管理员表单（含图片上传）
  // ============================================================
  function openForm(project, dateStr) {
    const isNew = !project;
    const p = project || {
      id: null, name: '', category: '', keywords: '',
      startDate: dateStr || fmtDate(new Date()),
      endDate: dateStr || fmtDate(new Date()),
      description: '', images: []
    };
    p.id = p.id || uid();
    state.editingId = p.id;
    const formImages = (p.images || []).slice();

    const catOptions = ['<option value="">请选择（可选）</option>'].concat(
      CATEGORIES.map(function (c) {
        return '<option value="' + c.key + '" ' + (p.category === c.key ? 'selected' : '') + '>' + c.key + '</option>';
      })
    ).join('');

    const html =
      '<form class="admin-form" id="adminForm">' +
        '<label class="form-row required"><span>项目名称</span><input type="text" name="name" value="' + esc(p.name) + '" required></label>' +
        '<label class="form-row"><span>分类</span><select name="category">' + catOptions + '</select></label>' +
        '<label class="form-row required"><span>开始日期</span><input type="date" name="startDate" value="' + esc(p.startDate) + '" required></label>' +
        '<label class="form-row required"><span>结束日期</span><input type="date" name="endDate" value="' + esc(p.endDate) + '" required></label>' +
        '<label class="form-row form-row--full required"><span>项目简介</span><textarea name="description" rows="4" required>' + esc(p.description) + '</textarea></label>' +
        '<label class="form-row form-row--full"><span>活动图片</span>' +
          '<div class="img-uploader">' +
            '<label class="img-add"><input type="file" id="imgInput" accept="image/*" multiple hidden><span>+ 添加图片</span></label>' +
            '<div class="img-grid" id="imgGrid"></div>' +
          '</div>' +
        '</label>' +
        '<div class="form-actions form-row--full">' +
          '<button type="submit" class="btn btn-primary">' + (isNew ? '保存' : '更新') + '</button>' +
          (isNew ? '' : '<button type="button" class="btn btn-danger" id="btnDelete">删除</button>') +
          '<button type="button" class="btn btn-ghost" id="btnCancel">取消</button>' +
        '</div>' +
      '</form>';

    showModal(isNew ? '新增活动' : '编辑活动', html, { wide: true });

    function renderImgGrid() {
      const grid = document.getElementById('imgGrid');
      if (!grid) return;
      grid.innerHTML = formImages.map(function (url, i) {
        return '<div class="img-thumb"><img src="' + esc(url) + '"><button type="button" class="img-del" data-i="' + i + '">×</button></div>';
      }).join('');
      grid.querySelectorAll('.img-del').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const i = parseInt(btn.dataset.i, 10);
          const url = formImages[i];
          const name = url.split('/').pop();
          formImages.splice(i, 1);
          renderImgGrid();
          try { await deleteImage(p.id, name); } catch (e) { /* ignore */ }
        });
      });
    }
    renderImgGrid();

    const imgInput = document.getElementById('imgInput');
    if (imgInput) imgInput.addEventListener('change', async function (e) {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        try {
          const url = await uploadImage(p.id, file);
          formImages.push(url);
          renderImgGrid();
        } catch (err) {
          alert('图片上传失败：' + (err && err.message ? err.message : err));
        }
      }
      e.target.value = '';
    });

    document.getElementById('adminForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = {
        id: state.editingId || uid(),
        name: String(fd.get('name') || '').trim(),
        category: String(fd.get('category') || ''),
        keywords: String(p.keywords || ''),  // 字段已从表单移除，保留旧数据不丢失
        startDate: String(fd.get('startDate') || ''),
        endDate: String(fd.get('endDate') || ''),
        description: String(fd.get('description') || '').trim(),
        images: formImages.slice(),
      };
      if (!data.name || !data.startDate || !data.endDate || !data.description) {
        alert('请填写必填项：项目名称、开始日期、结束日期、项目简介');
        return;
      }
      const sd = parseDate(data.startDate);
      const ed = parseDate(data.endDate);
      if (!sd || !ed) { alert('日期格式错误'); return; }
      if (ed < sd) { alert('结束日期不能早于开始日期'); return; }

      if (state.editingId && state.projects.some(function (x) { return x.id === state.editingId; })) {
        const idx = state.projects.findIndex(function (x) { return x.id === state.editingId; });
        state.projects[idx] = data;
      } else {
        state.projects.push(data);
      }
      state.projects.sort(function (a, b) { return a.startDate.localeCompare(b.startDate); });
      saveProjects();
      closeModal();
      renderView();
    });

    const cancelBtn = document.getElementById('btnCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    const delBtn = document.getElementById('btnDelete');
    if (delBtn) delBtn.addEventListener('click', async function () {
      if (confirm('确定删除该活动？关联的图片也会一并删除。')) {
        // 删除服务器上的图片
        const proj = state.projects.find(function (x) { return x.id === state.editingId; });
        if (proj && proj.images && proj.images.length) {
          for (const url of proj.images) {
            try { await deleteImage(proj.id, url.split('/').pop()); } catch (e) { /* ignore */ }
          }
        }
        state.projects = state.projects.filter(function (x) { return x.id !== state.editingId; });
        saveProjects();
        closeModal();
        renderView();
      }
    });
  }

  // ============================================================
  // 显示设置（管理员：游客可见性）
  // ============================================================
  function toggleRow(v, label) {
    return '<label class="settings-row"><span>' + label + '</span>' +
      '<input type="checkbox" id="vis_' + v + '" ' + (state.visibility[v] ? 'checked' : '') + '></label>';
  }
  function openSettings() {
    const html =
      '<div class="settings-panel">' +
        toggleRow('calendar', '向游客显示「日历」') +
        toggleRow('monthly', '向游客显示「月历」') +
        '<div class="settings-hint muted">关闭后游客顶栏仅显示「活动」；管理员始终可见全部视图。设置保存在本地浏览器。</div>' +
      '</div>';
    showModal('显示设置', html);
    ['calendar', 'monthly'].forEach(function (v) {
      const cb = document.getElementById('vis_' + v);
      if (cb) cb.addEventListener('change', function () {
        state.visibility[v] = cb.checked;
        saveVisibility();
        renderTopBar();
        if (!tabVisible(state.view)) setView('activity');
      });
    });
  }

  // ============================================================
  // 节假日管理弹窗
  // ============================================================
  function openHolidayManager() {
    function renderHolidayList() {
      const list = $('#holidayList');
      const items = state.holidays.slice().sort(function (a, b) { return a.startDate.localeCompare(b.startDate); });
      if (!items.length) {
        list.innerHTML = '<div class="muted">暂无节假日数据</div>';
        return;
      }
      list.innerHTML = items.map(function (h) {
        const range = h.startDate === h.endDate ? h.startDate : h.startDate + ' ~ ' + h.endDate;
        const typeLabel = h.type === 'holiday' ? '节假日' : '调休上班';
        return '<div class="holiday-row">' +
          '<div class="holiday-info">' +
            '<div class="holiday-name">' + esc(h.name) + '</div>' +
            '<div class="holiday-meta">' + esc(typeLabel) + ' · ' + esc(range) + '</div>' +
          '</div>' +
          '<button class="btn btn-danger btn-sm btn-delete-holiday" data-id="' + h.id + '">删除</button>' +
        '</div>';
      }).join('');

      list.querySelectorAll('.btn-delete-holiday').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const id = btn.dataset.id;
          state.holidays = state.holidays.filter(function (h) { return h.id !== id; });
          saveHolidays();
          renderHolidayList();
          renderView();
        });
      });
    }

    const html =
      '<div class="holiday-manager">' +
        '<form class="admin-form" id="holidayForm">' +
          '<div class="form-row required"><span>名称</span><input type="text" name="name" placeholder="如：春节" required></div>' +
          '<div class="form-row required"><span>开始日期</span><input type="date" name="startDate" required></div>' +
          '<div class="form-row required"><span>结束日期</span><input type="date" name="endDate" required></div>' +
          '<div class="form-row required"><span>类型</span><select name="type"><option value="holiday">节假日</option><option value="workday">调休上班</option></select></div>' +
          '<div class="form-actions"><button type="submit" class="btn btn-primary">添加</button></div>' +
        '</form>' +
        '<div class="holiday-list" id="holidayList"></div>' +
      '</div>';

    showModal('节假日管理', html);
    renderHolidayList();

    $('#holidayForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = {
        id: uid(),
        name: String(fd.get('name') || '').trim(),
        startDate: String(fd.get('startDate') || ''),
        endDate: String(fd.get('endDate') || ''),
        type: String(fd.get('type') || 'holiday'),
      };
      const sd = parseDate(data.startDate);
      const ed = parseDate(data.endDate);
      if (!data.name || !sd || !ed) { alert('请填写完整信息'); return; }
      if (ed < sd) { alert('结束日期不能早于开始日期'); return; }
      state.holidays.push(data);
      saveHolidays();
      e.target.reset();
      renderHolidayList();
      renderView();
    });
  }

  // ============================================================
  // 登录 / 退出
  // ============================================================
  function showLoginModal() {
    const html =
      '<form class="admin-form" id="loginForm">' +
        '<label class="form-row required"><span>密码</span><input type="password" name="password" required></label>' +
        '<div class="form-actions"><button type="submit" class="btn btn-primary">登录</button><button type="button" class="btn btn-ghost" id="btnCancel">取消</button></div>' +
      '</form>';
    showModal('管理员登录', html);

    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const pwd = new FormData(e.target).get('password');
      if (pwd === ADMIN_PASSWORD) {
        state.isLoggedIn = true;
        localStorage.setItem(ADMIN_LOGGED_KEY, '1');
        closeModal();
        renderTopBar();
        renderView();
        initialSync(); // 登录后立即合并：本地独有活动自动上传到服务器
      } else {
        alert('密码错误');
      }
    });
    $('#btnCancel').addEventListener('click', closeModal);
  }

  function logout() {
    state.isLoggedIn = false;
    localStorage.removeItem(ADMIN_LOGGED_KEY);
    renderTopBar();
    renderView();
  }

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    if (localStorage.getItem(ADMIN_LOGGED_KEY) === '1') state.isLoggedIn = true;
    loadVisibility();
    loadProjects();
    loadHolidays();
    // 先用本地缓存渲染（秒开），随后从服务器拉取共享数据并覆盖
    renderTopBar();
    setView('activity');
    initialSync();
  }

  init();
})();
