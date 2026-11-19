// ============================================================================
// BBT 軟式棒球聯盟 - 前端主控邏輯 (index.js)
// 支援全聯盟分組總覽、手機緊湊版面、本隊/他隊已核准FA、FA審查與聯盟/本隊公告上下分區
// ============================================================================

let globalData = {
  teams: [],
  roster: [],
  stats: [],
  announcements: [],
  league_announcements: [],
  transactions: [],
  attendance: [],
  users: [],
  history: []
};
window.globalData = globalData;

let currentSelectedTeamId = '';
window.currentSelectedTeamId = '';
let currentDivision = 'ALL'; // 'ALL' 表示全聯盟（未選組別）
window.currentDivision = 'ALL';
let currentSeason = '2026-S18';
let currentRosterFilter = 'all';
let activePlayerCardCache = null;
let activeCardUserId = '';
let globalGameCache = {};
let currentUser = null;
let pendingReviewTxCache = null;

const REMOTE_SCHEDULE_SHEET_ID = '1kgJti-vuALVDPhVWHdb0G5_Ows4Usp61Y00L9JMrrmw';
const DIVISION_ORDER = ['大聯盟', '小聯盟', '育成組'];

document.addEventListener('DOMContentLoaded', async () => {
  attachActionFeedbackHooks_();
  showActionStatus('系統初始化中...', 'loading', 0);
  await initSystem();
});

async function initSystem() {
  const res = await BBTApi.getInitData(currentSeason, '');
  if (res && res.result === 'ok') {
    globalData.teams = res.teams || [];
    globalData.roster = res.roster || [];
    globalData.stats = res.stats || [];
    globalData.announcements = res.announcements || [];
    globalData.league_announcements = res.league_announcements || [];
    globalData.transactions = res.transactions || [];
    globalData.attendance = res.attendance || [];
    globalData.users = res.users || [];
    globalData.history = res.history || [];
    if (res.fa_window_config && typeof saveFaWindowConfig_ === 'function') {
      const mergedFaCfg = {
        ...(typeof getDefaultFaWindowConfig_ === 'function' ? getDefaultFaWindowConfig_() : {}),
        ...res.fa_window_config,
        enabled: res.fa_window_config.enabled !== undefined ? Boolean(res.fa_window_config.enabled) : true
      };
      saveFaWindowConfig_(mergedFaCfg);
      if (typeof syncFaWindowUiImmediately_ === 'function') {
        syncFaWindowUiImmediately_(mergedFaCfg);
      }
    }
    window.globalData = globalData;

    const restoredUser = typeof BBTAuth !== 'undefined' && typeof BBTAuth.restoreSession === 'function'
      ? BBTAuth.restoreSession()
      : null;
    currentUser = restoredUser;
    window.currentUser = restoredUser;

    if (!restoredUser) {
      document.getElementById('userNameDisplay').innerText = '未登入';
      document.getElementById('userTitleDisplay').innerText = '請先登入系統';
      const kpiSection = document.getElementById('unselectedKpiSection');
      const selectedSection = document.getElementById('selectedTeamSection');
      const leftSidebar = document.getElementById('leftTeamSidebar');
      if (kpiSection) kpiSection.classList.add('hidden');
      if (selectedSection) selectedSection.classList.add('hidden');
      if (leftSidebar) leftSidebar.classList.add('hidden');
      if (typeof BBTAuth !== 'undefined' && typeof BBTAuth.openLoginModal === 'function') {
        BBTAuth.openLoginModal();
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    if (typeof BBTAuth !== 'undefined' && typeof BBTAuth.applyRolePermissions === 'function') {
      BBTAuth.applyRolePermissions();
    }
    currentUser = typeof BBTAuth !== 'undefined' && typeof BBTAuth.getCurrentUser === 'function'
      ? BBTAuth.getCurrentUser()
      : currentUser;

    if (typeof renderSeasonDropdowns_ === 'function') {
      renderSeasonDropdowns_();
    }
    syncDivisionButtonsUI();
    if (isPersonalOrTeamView_()) {
      const ownTeamId = getPreferredUserTeamId_();
      if (ownTeamId) {
        selectTeam(ownTeamId);
      } else {
        renderTeamSidebar('');
        renderOverviewKpiBoard();
      }
    } else {
      renderTeamSidebar(document.getElementById('teamSearchInput')?.value || '');
      renderOverviewKpiBoard();
    }

    if (currentSelectedTeamId) {
      await loadRemoteScheduleOptions();
      renderAnnouncements();
    }
    renderTransactions();
  } else {
    renderOverviewKpiBoard();
    alert('無法連線至 Google Sheets 資料庫，請檢查 API 網址或部署權限。');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- 同步頂部組別按鈕樣式（防止手機換行） ---
function isPersonalOrTeamView_() {
  return Boolean(currentUser && currentUser.role !== 'super_admin');
}

function getPreferredUserTeamId_() {
  const uid = String(currentUser?.user_id || '').trim();
  const utid = String(currentUser?.team_id || '').trim();
  if (utid && (globalData.teams || []).some(t => String(t.team_id).trim() === utid)) {
    return utid;
  }
  if (uid) {
    const rMatch = (globalData.roster || []).find(r => String(r.user_id || '').trim() === uid && !isInactiveRosterStatus_(r.status));
    if (rMatch && (globalData.teams || []).some(t => String(t.team_id).trim() === String(rMatch.team_id).trim())) {
      return String(rMatch.team_id).trim();
    }
  }
  return utid;
}

function syncPersonalHeaderAndLayout_() {
  const isPersonalView = isPersonalOrTeamView_();

  // 1. 個人登入時精簡上方 Header 組別切換列，避免誤切全聯盟組別
  const divGroup = document.getElementById('divisionSwitchGroup');
  if (divGroup) {
    divGroup.classList.toggle('hidden', isPersonalView);
  }

  // 2. 個人登入時隱藏左側「聯盟球隊清單」側邊欄與「返回 KPI 總覽」按鈕
  const leftSidebar = document.getElementById('leftTeamSidebar');
  const mainGrid = leftSidebar ? leftSidebar.parentElement : null;
  if (leftSidebar) {
    if (isPersonalView) {
      leftSidebar.classList.add('hidden');
      leftSidebar.classList.remove('lg:block');
      if (mainGrid) {
        mainGrid.classList.remove('lg:grid-cols-12');
        mainGrid.classList.add('grid-cols-1');
      }
    } else {
      leftSidebar.classList.remove('lg:block');
      if (mainGrid) {
        mainGrid.classList.add('lg:grid-cols-12');
        mainGrid.classList.remove('grid-cols-1');
      }
    }
  }

  // 隱藏球隊主卡中的「返回 KPI 總覽」按鈕
  const selectedSection = document.getElementById('selectedTeamSection');
  if (selectedSection && isPersonalView) {
    const btns = Array.from(selectedSection.querySelectorAll('button'));
    btns.forEach(b => {
      const txt = String(b.textContent || '');
      if (txt.includes('返回 KPI 總覽') || txt.includes('返回全球隊總覽')) {
        b.classList.add('hidden');
      }
    });
    const backBar = document.getElementById('mobileBackToTeamsBar');
    if (backBar) backBar.classList.add('hidden');
  }
}

function syncDivisionButtonsUI() {
  const groupEl = document.getElementById('divisionSwitchGroup');
  if (groupEl) {
    groupEl.classList.add('overflow-x-auto', 'whitespace-nowrap', 'max-w-full');
  }
  const btnMap = {
    'ALL': 'btn-all',
    '大聯盟': 'btn-maj',
    '小聯盟': 'btn-min',
    '育成組': 'btn-rok'
  };
  Object.entries(btnMap).forEach(([divKey, btnId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (divKey === currentDivision) {
      btn.className = 'px-3 py-1 rounded-lg text-xs font-black bg-bbt-navy text-white shadow-sm transition whitespace-nowrap shrink-0';
    } else {
      btn.className = 'px-3 py-1 rounded-lg text-xs font-bold text-slate-300 hover:bg-slate-700/80 transition whitespace-nowrap shrink-0';
    }
  });
  syncPersonalHeaderAndLayout_();
}

// --- 共用隊徽元件（僅圖示 + 備用字） ---
function buildTeamLogoHtml(team, sizeClass = 'w-12 h-12 text-base') {
  const teamNameStr = String(team.team_name || '').trim();
  const fallbackChar = teamNameStr.substring(0, 1) || 'B';
  const logoPath = `logo/${team.team_id}.png`;
  return `
    <div class="${sizeClass} rounded-2xl overflow-hidden bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black flex items-center justify-center shadow shrink-0">
      <img src="${logoPath}" alt="${teamNameStr}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <span style="display:none;" class="w-full h-full items-center justify-center">${fallbackChar}</span>
    </div>
  `;
}

// --- 依組別分組球隊 ---
function groupTeamsByDivision(teamsList) {
  const groups = [];
  const usedIds = new Set();

  DIVISION_ORDER.forEach(divName => {
    const matched = teamsList.filter(t => String(t.division || '').trim() === divName);
    matched.forEach(t => usedIds.add(String(t.team_id)));
    if (matched.length > 0) {
      groups.push({ division: divName, teams: matched });
    }
  });

  const others = teamsList.filter(t => !usedIds.has(String(t.team_id)));
  if (others.length > 0) {
    groups.push({ division: '其他組別', teams: others });
  }
  return groups;
}

// --- 控制手機版側邊欄與返回按鈕，避免手機重複清單與過度捲動 ---
function syncMobileViewportLayout(hasSelectedTeam) {
  const leftSidebar = document.getElementById('leftTeamSidebar');
  if (leftSidebar) {
    leftSidebar.classList.add('hidden', 'lg:block');
  }

  const selectedSection = document.getElementById('selectedTeamSection');
  if (selectedSection && hasSelectedTeam) {
    let backBar = document.getElementById('mobileBackToTeamsBar');
    if (!backBar) {
      backBar = document.createElement('div');
      backBar.id = 'mobileBackToTeamsBar';
      backBar.className = 'lg:hidden mb-2.5 flex items-center justify-between';
      backBar.innerHTML = `
        <button onclick="showKpiOverview()" class="inline-flex items-center gap-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 text-xs font-black px-3 py-1.5 rounded-xl shadow-sm transition whitespace-nowrap">
          <i data-lucide="arrow-left" class="w-3.5 h-3.5 text-emerald-600"></i>
          <span>返回全球隊總覽</span>
        </button>
        <span class="text-[11px] font-bold text-slate-400">點選上方組別可快速切換</span>
      `;
      selectedSection.insertBefore(backBar, selectedSection.firstChild);
    }
  }
}

// --- 未選隊 KPI 總覽與全球隊分組畫面 ---
function showKpiOverview() {
  if (isPersonalOrTeamView_()) {
    const ownTeamId = getPreferredUserTeamId_();
    if (ownTeamId) {
      selectTeam(ownTeamId);
      return;
    }
  }
  currentSelectedTeamId = '';
  window.currentSelectedTeamId = '';
  renderTeamSidebar(document.getElementById('teamSearchInput')?.value || '');
  renderOverviewKpiBoard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function focusTeamPicker() {
  const boardEl = document.getElementById('allTeamsDivisionBoard');
  if (boardEl) {
    boardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const searchInput = document.getElementById('teamSearchInput');
  if (searchInput) searchInput.focus();
}

const FA_WINDOW_STORAGE_KEY = 'BBT_FA_WINDOW_CONFIG_V1';

function getDefaultFaWindowConfig_() {
  const seasonYearMatch = String(currentSeason || '').match(/(\d{4})/);
  const baseYear = seasonYearMatch ? Number(seasonYearMatch[1]) : new Date().getFullYear();
  const targetYear = baseYear + 1;
  return {
    enabled: true,
    startDate: `${targetYear}-02-01`,
    endDate: `${targetYear}-02-28`,
    label: `${targetYear} 年度 FA 申請期間`
  };
}

function getFaWindowConfig_() {
  const defaults = getDefaultFaWindowConfig_();
  try {
    const raw = localStorage.getItem(FA_WINDOW_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== undefined ? Boolean(parsed.enabled) : defaults.enabled,
      startDate: parsed.startDate || defaults.startDate,
      endDate: parsed.endDate || defaults.endDate,
      label: parsed.label || defaults.label
    };
  } catch (err) {
    return defaults;
  }
}

let faWindowConfigCache_ = null;

function saveFaWindowConfig_(cfg) {
  const normalized = {
    enabled: Boolean(cfg.enabled),
    startDate: String(cfg.startDate || '').trim(),
    endDate: String(cfg.endDate || '').trim(),
    label: String(cfg.label || `${currentSeason} 年度 FA 申請期間`).trim()
  };
  faWindowConfigCache_ = normalized;
  try {
    localStorage.setItem(FA_WINDOW_STORAGE_KEY, JSON.stringify(normalized));
  } catch (err) {
    // 忽略儲存空間限制錯誤，仍保留記憶體快取
  }
}

function getEffectiveFaWindowConfig_() {
  if (faWindowConfigCache_) {
    return { ...faWindowConfigCache_ };
  }
  const cfg = getFaWindowConfig_();
  faWindowConfigCache_ = { ...cfg };
  return cfg;
}

function syncFaWindowUiImmediately_(cfg) {
  const winStatus = checkFaWindowStatus_(new Date(), cfg);
  const enabledEl = document.getElementById('faWindowEnabledInput');
  const startEl = document.getElementById('faWindowStartInput');
  const endEl = document.getElementById('faWindowEndInput');
  const badgeEl = document.getElementById('faWindowStatusBadge');
  const kpiCard = document.getElementById('kpiAnnualFaCard');

  if (enabledEl) enabledEl.checked = Boolean(cfg.enabled);
  if (startEl) startEl.value = cfg.startDate || '';
  if (endEl) endEl.value = cfg.endDate || '';

  if (badgeEl) {
    badgeEl.innerText = winStatus.isOpen ? '目前開放申請' : '目前未開放';
    badgeEl.className = winStatus.isOpen
      ? 'px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 whitespace-nowrap'
      : 'px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-800 whitespace-nowrap';
  }

  if (kpiCard) {
    const divs = kpiCard.querySelectorAll('div');
    const subEl = divs.length > 0 ? divs[divs.length - 1] : null;
    if (subEl) {
      const text = subEl.innerText || '';
      subEl.innerText = text.includes('·')
        ? `${text.split('·')[0].trim()} · ${winStatus.isOpen ? '申請開放中' : '申請未開放'}`
        : (winStatus.isOpen ? '申請開放中' : '申請未開放');
    }
  }
}

function checkFaWindowStatus_(nowDate = new Date(), overrideCfg = null) {
  const cfg = overrideCfg || getEffectiveFaWindowConfig_();
  if (!cfg.enabled) {
    return {
      isOpen: false,
      reason: '聯盟目前已關閉年度 FA 申請開關',
      cfg
    };
  }
  const todayStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  if (cfg.startDate && todayStr < cfg.startDate) {
    return {
      isOpen: false,
      reason: `尚未開放（開放期間：${cfg.startDate} 至 ${cfg.endDate || '未定'}）`,
      cfg
    };
  }
  if (cfg.endDate && todayStr > cfg.endDate) {
    return {
      isOpen: false,
      reason: `申請期間已截止（開放期間：${cfg.startDate || '未定'} 至 ${cfg.endDate}）`,
      cfg
    };
  }
  return {
    isOpen: true,
    reason: `申請開放中（${cfg.startDate || '—'} ～ ${cfg.endDate || '—'}）`,
    cfg
  };
}

function ensureLeagueFaCenterModal_() {
  if (document.getElementById('leagueFaCenterModal')) return;

  const modal = document.createElement('div');
  modal.id = 'leagueFaCenterModal';
  modal.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-slate-900/60 p-3';
  modal.innerHTML = `
    <div class="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
      <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
        <div class="font-black text-sm flex items-center gap-2 whitespace-nowrap">
          <i data-lucide="gavel" class="w-4 h-4 text-emerald-400"></i>
          <span>聯盟 FA 審查與年度申請期間設定</span>
        </div>
        <button onclick="closeLeagueFaCenterModal()" class="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 whitespace-nowrap">✕</button>
      </div>

      <div class="p-4 overflow-y-auto space-y-4 text-xs">
        <!-- 年度 FA 申請開關與期間設定 -->
        <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="font-black text-slate-900 flex items-center gap-1.5 whitespace-nowrap">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>年度 FA 申請開關與起訖日期</span>
            </div>
            <span id="faWindowStatusBadge" class="px-2.5 py-0.5 rounded-full text-[11px] font-black whitespace-nowrap"></span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
            <label class="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 cursor-pointer select-none">
              <input id="faWindowEnabledInput" type="checkbox" class="w-4 h-4 rounded text-emerald-600 border-slate-300">
              <span class="font-black text-slate-800 whitespace-nowrap">啟用 FA 申請通道</span>
            </label>
            <div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">開放起始日</label>
              <input id="faWindowStartInput" type="date" class="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800">
            </div>
            <div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">開放截止日</label>
              <input id="faWindowEndInput" type="date" class="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800">
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 pt-1">
            <span id="faWindowHintText" class="text-[11px] text-slate-500">僅在啟用且位於起訖日期內時，球員才可提出 FA 宣告。</span>
            <button type="button" onclick="saveLeagueFaWindowSetting()" class="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs whitespace-nowrap shrink-0">儲存期間設定</button>
          </div>
        </div>

        <!-- 聯盟待審核與年度 FA 審查清單 -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="font-black text-slate-900 whitespace-nowrap">FA 宣告案件審查清單</div>
            <span id="leagueFaPendingSummary" class="text-[11px] font-bold text-amber-700 whitespace-nowrap"></span>
          </div>
          <div id="leagueFaReviewList" class="space-y-2"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function refreshLeagueFaCenterContent_(overrideCfg = null) {
  const cfg = overrideCfg || getEffectiveFaWindowConfig_();
  const winStatus = checkFaWindowStatus_();

  const enabledEl = document.getElementById('faWindowEnabledInput');
  const startEl = document.getElementById('faWindowStartInput');
  const endEl = document.getElementById('faWindowEndInput');
  const badgeEl = document.getElementById('faWindowStatusBadge');
  const summaryEl = document.getElementById('leagueFaPendingSummary');
  const listEl = document.getElementById('leagueFaReviewList');

  if (enabledEl) enabledEl.checked = cfg.enabled;
  if (startEl) startEl.value = cfg.startDate || '';
  if (endEl) endEl.value = cfg.endDate || '';

  if (badgeEl) {
    badgeEl.innerText = winStatus.isOpen ? '目前開放申請' : '目前未開放';
    badgeEl.className = winStatus.isOpen
      ? 'px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 whitespace-nowrap'
      : 'px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-800 whitespace-nowrap';
  }

  const allFaTxs = (globalData.transactions || []).filter(tx => isFaRecord_(tx));
  const pendingFaTxs = allFaTxs.filter(tx => isPendingStatus_(tx.admin_status));
  const approvedFaTxs = allFaTxs.filter(tx => isApprovedStatus_(tx.admin_status));

  if (summaryEl) {
    summaryEl.innerText = `待審核 ${pendingFaTxs.length} 筆・年度已核准 ${approvedFaTxs.length} 人`;
  }

  if (listEl) {
    if (allFaTxs.length === 0) {
      listEl.innerHTML = `<div class="p-4 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">目前尚無任何 FA 宣告紀錄</div>`;
    } else {
      listEl.innerHTML = allFaTxs.map(tx => {
        const playerLabel = formatTxPlayerName_(tx);
        const fromTeam = (globalData.teams || []).find(t => String(t.team_id) === String(tx.from_team_id));
        const teamName = fromTeam ? fromTeam.team_name : (tx.from_team_id || '—');
        const statusText = tx.admin_status || 'pending';
        const isPending = isPendingStatus_(statusText);
        const isApproved = isApprovedStatus_(statusText);
        const statusBadge = isApproved
          ? '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] whitespace-nowrap">已核准</span>'
          : (isPending
              ? '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px] whitespace-nowrap">待審核</span>'
              : `<span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px] whitespace-nowrap">${statusText}</span>`);

        const actionBtns = (isPending && tx.tx_id)
          ? `
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" onclick="openFaReviewModal('${String(tx.tx_id).replace(/'/g, "\'")}', 'approved')" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] whitespace-nowrap">核准</button>
              <button type="button" onclick="openFaReviewModal('${String(tx.tx_id).replace(/'/g, "\'")}', 'rejected')" class="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-black text-[11px] whitespace-nowrap">駁回</button>
            </div>
          `
          : '';

        return `
          <div class="p-3 rounded-xl border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
            <div class="space-y-0.5 min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-black text-slate-900">${playerLabel}</span>
                <span class="text-[11px] font-bold text-slate-500">(${teamName})</span>
                ${statusBadge}
              </div>
              <div class="text-[11px] text-slate-600">${tx.note || '—'}</div>
              <div class="text-[10px] text-slate-400">${tx.tx_date || ''} · ${tx.tx_id || ''}</div>
            </div>
            ${actionBtns}
          </div>
        `;
      }).join('');
    }
  }
}

function openLeagueFaCenterModal() {
  const isSuper = Boolean(currentUser && currentUser.role === 'super_admin');
  if (!isSuper) {
    alert('僅聯盟總管理員可使用 FA 審查與期間設定');
    return;
  }
  ensureLeagueFaCenterModal_();
  refreshLeagueFaCenterContent_();
  bindFaWindowInstantListeners_();
  const modal = document.getElementById('leagueFaCenterModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeLeagueFaCenterModal() {
  const modal = document.getElementById('leagueFaCenterModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function applyFaWindowDraftChange_() {
  const enabledEl = document.getElementById('faWindowEnabledInput');
  const startEl = document.getElementById('faWindowStartInput');
  const endEl = document.getElementById('faWindowEndInput');
  const draft = {
    enabled: Boolean(enabledEl?.checked),
    startDate: String(startEl?.value || '').trim(),
    endDate: String(endEl?.value || '').trim(),
    label: `${currentSeason} 年度 FA 申請期間`
  };
  saveFaWindowConfig_(draft);
  syncFaWindowUiImmediately_(draft);
  renderOverviewKpiBoard();
}

function bindFaWindowInstantListeners_() {
  const enabledEl = document.getElementById('faWindowEnabledInput');
  const startEl = document.getElementById('faWindowStartInput');
  const endEl = document.getElementById('faWindowEndInput');

  [enabledEl, startEl, endEl].forEach(el => {
    if (!el || el.dataset.faInstantBound === '1') return;
    el.dataset.faInstantBound = '1';
    el.addEventListener('change', applyFaWindowDraftChange_);
    el.addEventListener('input', applyFaWindowDraftChange_);
  });
}

async function saveLeagueFaWindowSetting() {
  const enabled = Boolean(document.getElementById('faWindowEnabledInput')?.checked);
  const startDate = String(document.getElementById('faWindowStartInput')?.value || '').trim();
  const endDate = String(document.getElementById('faWindowEndInput')?.value || '').trim();

  if (enabled && startDate && endDate && startDate > endDate) {
    alert('開放起始日不可晚於截止日');
    return;
  }

  const nextCfg = {
    enabled,
    startDate,
    endDate,
    label: `${currentSeason} 年度 FA 申請期間`
  };
  saveFaWindowConfig_(nextCfg);
  syncFaWindowUiImmediately_(nextCfg);

  if (typeof callApi === 'function') {
    const apiRes = await callApi('saveFaWindowConfig', { data: JSON.stringify(nextCfg) });
    if (apiRes && apiRes.result !== 'ok') {
      alert('❌ 同步後端 FA 期間設定失敗：' + (apiRes.message || '未知錯誤'));
      return;
    }
  }

  refreshLeagueFaCenterContent_(nextCfg);
  renderOverviewKpiBoard();
  alert('✅ 已儲存並同步年度 FA 申請開關與期間設定！');
}

function renderOverviewKpiBoard() {
  syncPersonalHeaderAndLayout_();
  if (isPersonalOrTeamView_()) {
    const ownTeamId = getPreferredUserTeamId_();
    if (ownTeamId && String(currentSelectedTeamId) !== String(ownTeamId)) {
      selectTeam(ownTeamId);
      return;
    }
  }
  const kpiSection = document.getElementById('unselectedKpiSection');
  const selectedSection = document.getElementById('selectedTeamSection');
  const hasSelectedTeam = Boolean(currentSelectedTeamId && globalData.teams.some(t => String(t.team_id) === String(currentSelectedTeamId)));

  syncMobileViewportLayout(hasSelectedTeam);

  if (hasSelectedTeam) {
    kpiSection.classList.add('hidden');
    selectedSection.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  kpiSection.classList.remove('hidden');
  selectedSection.classList.add('hidden');

  const allTeams = globalData.teams || [];
  const isSuper = currentUser && currentUser.role === 'super_admin';
  const isAllDiv = currentDivision === 'ALL';

  const scopedTeams = !isSuper
    ? allTeams.filter(t => String(t.team_id).trim() === String(currentUser?.team_id || '').trim())
    : (isAllDiv ? allTeams : allTeams.filter(t => String(t.division || '').trim() === currentDivision));

  const scopedTeamIds = new Set(scopedTeams.map(t => String(t.team_id).trim()));
  const scopedTeamNames = new Set(
    scopedTeams.map(t => String(t.team_name || '').trim()).filter(Boolean)
  );
  const scopedRoster = (globalData.roster || []).filter(r => {
    if (!scopedTeamIds.has(String(r.team_id).trim())) return false;
    const statusStr = String(r.status || '').trim().toLowerCase();
    if (statusStr !== 'approved') return false;
    if (getApprovedFaForRosterRow_(r)) return false;
    return true;
  });
  const uniqueActiveRosterIds = new Set(
    scopedRoster.map(r => String(r.user_id || '').trim()).filter(Boolean)
  );
  const scopedAtt = (globalData.attendance || []).filter(a => scopedTeamIds.has(String(a.team_id).trim()));

  const isTxInScope_ = (tx) => {
    if (!isSuper || isAllDiv) return true;
    const refs = [
      String(tx.from_team_id || '').trim(),
      String(tx.to_team_id || '').trim(),
      String(tx.team_id || '').trim(),
      String(tx.from_team_name || '').trim(),
      String(tx.to_team_name || '').trim()
    ].filter(Boolean);
    if (refs.some(v => scopedTeamIds.has(v) || scopedTeamNames.has(v))) {
      return true;
    }
    const uid = String(tx.user_id || '').trim();
    if (!uid) return false;
    return (globalData.roster || []).some(r =>
      String(r.user_id || '').trim() === uid && scopedTeamIds.has(String(r.team_id).trim())
    );
  };

  const isHistoryInScope_ = (h) => {
    if (!isSuper || isAllDiv) return true;
    const tid = String(h.team_id || '').trim();
    const tname = String(h.team_name || '').trim();
    if ((tid && scopedTeamIds.has(tid)) || (tname && scopedTeamNames.has(tname))) {
      return true;
    }
    const uid = String(h.user_id || '').trim();
    if (!uid) return false;
    return (globalData.roster || []).some(r =>
      String(r.user_id || '').trim() === uid && scopedTeamIds.has(String(r.team_id).trim())
    );
  };

  const scopedTxs = (globalData.transactions || []).filter(isTxInScope_);
  const scopedHistory = (globalData.history || []).filter(isHistoryInScope_);
  const pendingTxCount = scopedTxs.filter(tx => String(tx.admin_status || '').trim() === 'pending').length;
  const historyTotal = scopedHistory.length + scopedTxs.length;

  document.getElementById('kpiSeasonBadge').innerText = currentSeason;
  document.getElementById('kpiSectionTitle').innerText = !isSuper
    ? '我的球隊與賽季總覽'
    : (isAllDiv ? '全聯盟 — 全球隊總覽' : `${currentDivision}組 — 球隊與賽季總覽`);

  document.getElementById('kpiTeamCount').innerText = scopedTeams.length;
  document.getElementById('kpiTotalTeamSub').innerText = `全聯盟共 ${allTeams.length} 隊`;
  document.getElementById('kpiRosterCount').innerText = uniqueActiveRosterIds.size;
  document.getElementById('kpiAccountCountSub').innerText = `已建帳號 ${(globalData.users || []).length} 筆`;
  document.getElementById('kpiAttendanceCount').innerText = scopedAtt.length;
  document.getElementById('kpiTxHistoryCount').innerText = historyTotal;
  document.getElementById('kpiPendingTxSub').innerText = `待審核 ${pendingTxCount} 筆`;

  const seasonPrefix = String(currentSeason || '').split('-')[0] || String(new Date().getFullYear());
  const scopedFaTxs = scopedTxs.filter(tx => {
    if (!isFaRecord_(tx)) return false;
    const dStr = String(tx.tx_date || '');
    return !dStr || dStr.startsWith(seasonPrefix);
  });
  const annualFaCount = scopedFaTxs.length;
  const annualApprovedFaCount = scopedFaTxs.filter(tx => isApprovedStatus_(tx.admin_status)).length;

  const kpiCardsGrid = document.getElementById('kpiTeamCount')?.closest('.grid');
  if (kpiCardsGrid) {
    kpiCardsGrid.classList.remove('grid-cols-1', 'grid-cols-2', 'sm:grid-cols-3', 'md:grid-cols-4', 'lg:grid-cols-5', 'gap-2.5', 'sm:gap-3');
    kpiCardsGrid.classList.add('grid-cols-3', 'sm:grid-cols-5', 'gap-1.5', 'sm:gap-2.5');

    let faKpiCard = document.getElementById('kpiAnnualFaCard');
    if (!faKpiCard) {
      faKpiCard = document.createElement('div');
      faKpiCard.id = 'kpiAnnualFaCard';
      kpiCardsGrid.appendChild(faKpiCard);
    }
    faKpiCard.className = 'bg-slate-50/90 border border-slate-200/80 rounded-xl p-2 sm:p-3 min-w-0';

    const existingCards = Array.from(kpiCardsGrid.children);
    existingCards.forEach(card => {
      card.classList.remove('p-3.5', 'p-4', 'rounded-2xl');
      card.classList.add('rounded-xl', 'p-2', 'sm:p-3', 'min-w-0');
      const divs = card.querySelectorAll('div');
      if (divs[0]) {
        divs[0].className = 'text-[10px] sm:text-[11px] font-bold text-slate-500 truncate';
      }
      if (divs[1]) {
        divs[1].className = divs[1].className
          .replace(/text-2xl|text-3xl/g, 'text-lg')
          .replace(/mt-1/g, 'mt-0.5') + ' sm:text-2xl leading-tight';
      }
      if (divs[2]) {
        divs[2].className = 'text-[9px] sm:text-[11px] text-slate-400 mt-0.5 truncate';
      }
    });

    const winStatus = checkFaWindowStatus_();
    faKpiCard.innerHTML = `
      <div class="text-[10px] sm:text-[11px] font-bold text-slate-500 truncate">年度 FA</div>
      <div id="kpiAnnualFaCount" class="text-lg sm:text-2xl font-black text-purple-700 mt-0.5 leading-tight">${annualFaCount}</div>
      <div class="text-[9px] sm:text-[11px] text-slate-400 mt-0.5 truncate">核准 ${annualApprovedFaCount} · ${winStatus.isOpen ? '開放中' : '未開放'}</div>
    `;
  }

  const btnKpiCreate = document.getElementById('btnKpiCreateTeam');
  if (btnKpiCreate) {
    btnKpiCreate.classList.toggle('hidden', !isSuper);
    const actionBar = btnKpiCreate.parentElement;
    if (actionBar) {
      actionBar.classList.add('flex-wrap', 'gap-1.5');
      btnKpiCreate.className = 'bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] sm:text-xs font-black px-2.5 sm:px-3 py-1.5 rounded-lg shadow-sm transition flex items-center gap-1 whitespace-nowrap shrink-0';
      btnKpiCreate.innerHTML = `<span>+ 新增球隊</span>`;

      let faBtn = document.getElementById('btnKpiFaReview');
      if (!faBtn) {
        faBtn = document.createElement('button');
        faBtn.id = 'btnKpiFaReview';
        faBtn.type = 'button';
        faBtn.onclick = openLeagueFaCenterModal;
        actionBar.insertBefore(faBtn, btnKpiCreate);
      }
      faBtn.className = `${isSuper ? '' : 'hidden '}bg-purple-600 hover:bg-purple-700 text-white text-[11px] sm:text-xs font-black px-2.5 sm:px-3 py-1.5 rounded-lg shadow-sm transition flex items-center gap-1 whitespace-nowrap shrink-0`;
      faBtn.innerHTML = `
        <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>
        <span>FA 審查${pendingTxCount > 0 ? ` (${pendingTxCount})` : ''}</span>
      `;

      let seasonBtn = document.getElementById('btnKpiSeasonMgr');
      if (!seasonBtn && typeof openSeasonManagerModal === 'function') {
        seasonBtn = document.createElement('button');
        seasonBtn.id = 'btnKpiSeasonMgr';
        seasonBtn.type = 'button';
        seasonBtn.onclick = openSeasonManagerModal;
        actionBar.insertBefore(seasonBtn, faBtn);
      }
      if (seasonBtn) {
        seasonBtn.className = `${isSuper ? '' : 'hidden '}bg-slate-800 hover:bg-slate-900 text-white text-[11px] sm:text-xs font-black px-2.5 sm:px-3 py-1.5 rounded-lg shadow-sm transition flex items-center gap-1 whitespace-nowrap shrink-0`;
        seasonBtn.innerHTML = `
          <i data-lucide="calendar-range" class="w-3.5 h-3.5 text-emerald-400"></i>
          <span>球季管理</span>
        `;
      }

      Array.from(actionBar.children).forEach(child => {
        if (child.tagName === 'BUTTON' || child.tagName === 'A') {
          child.classList.remove('px-3.5', 'py-2', 'rounded-xl');
          child.classList.add('px-2.5', 'sm:px-3', 'py-1.5', 'rounded-lg', 'text-[11px]', 'sm:text-xs');
        }
      });
    }
  }

  const chipsEl = document.getElementById('kpiQuickTeamChips');
  if (chipsEl) {
    chipsEl.classList.add('hidden');
  }

  let boardEl = document.getElementById('allTeamsDivisionBoard');
  if (!boardEl && chipsEl && chipsEl.parentElement) {
    boardEl = document.createElement('div');
    boardEl.id = 'allTeamsDivisionBoard';
    boardEl.className = 'mt-4 pt-3.5 border-t border-slate-100 space-y-4';
    chipsEl.parentElement.appendChild(boardEl);
  }

  if (boardEl) {
    if (scopedTeams.length === 0) {
      boardEl.innerHTML = `<div class="text-xs text-slate-400 py-4 text-center">目前尚無球隊資料，可點擊上方「+ 新增球隊」建立。</div>`;
    } else {
      const grouped = groupTeamsByDivision(scopedTeams);
      boardEl.innerHTML = grouped.map(grp => `
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 whitespace-nowrap">
              <span class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
              <h4 class="text-xs font-black text-slate-800 tracking-wide">${grp.division}組</h4>
              <span class="text-[11px] font-bold text-slate-400">(${grp.teams.length} 隊)</span>
            </div>
            <span class="text-[11px] text-slate-400 whitespace-nowrap">點選進入球員名單</span>
          </div>
          <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 sm:gap-3">
            ${grp.teams.map(t => `
              <button onclick="selectTeam('${t.team_id}')" class="group bg-slate-50 hover:bg-slate-900 active:scale-[0.98] border border-slate-200 hover:border-emerald-500 rounded-2xl p-2.5 sm:p-4 flex flex-col items-center justify-center gap-1.5 sm:gap-2.5 transition shadow-sm hover:shadow-md text-center min-w-0">
                ${buildTeamLogoHtml(t, 'w-11 h-11 sm:w-14 sm:h-14 text-base sm:text-lg')}
                <div class="font-black text-xs sm:text-sm text-slate-900 group-hover:text-white truncate w-full whitespace-nowrap">${t.team_name}</div>
              </button>
            `).join('')}
          </div>
        </div>
      `).join('');
    }
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- 新增球隊 ---
function openCreateTeamModal() {
  document.getElementById('newTeamName').value = '';
  document.getElementById('newTeamId').value = '';
  document.getElementById('newTeamDivision').value = (currentDivision && currentDivision !== 'ALL') ? currentDivision : '大聯盟';
  document.getElementById('newTeamSeason').value = currentSeason || '2026-S18';
  document.getElementById('newTeamCoach').value = '';
  document.getElementById('newTeamContact').value = '';
  document.getElementById('newTeamPhone').value = '';
  document.getElementById('newTeamIntro').value = '';

  document.getElementById('createTeamModal').classList.remove('hidden');
  document.getElementById('createTeamModal').classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeCreateTeamModal() {
  document.getElementById('createTeamModal').classList.add('hidden');
  document.getElementById('createTeamModal').classList.remove('flex');
}

async function submitCreateTeam() {
  const teamName = document.getElementById('newTeamName').value.trim();
  const teamId = document.getElementById('newTeamId').value.trim();
  const division = document.getElementById('newTeamDivision').value;
  const season = document.getElementById('newTeamSeason').value;
  const coach = document.getElementById('newTeamCoach').value.trim();
  const contactName = document.getElementById('newTeamContact').value.trim();
  const contactPhone = document.getElementById('newTeamPhone').value.trim();
  const intro = document.getElementById('newTeamIntro').value.trim();

  if (!teamName) {
    alert('請填寫球隊名稱');
    return;
  }

  const res = await BBTApi.saveTeamProfile({
    ...(teamId ? { team_id: teamId } : {}),
    team_name: teamName,
    division,
    season,
    coach,
    contact_name: contactName,
    contact_phone: contactPhone,
    intro,
    status: 'active'
  });

  if (res && res.result === 'ok') {
    const createdId = res.team_id || res.id || '';
    alert(`✅ 球隊「${teamName}」已建立${createdId ? `（代號：${createdId}）` : ''}！`);
    closeCreateTeamModal();
    currentDivision = division;
    window.currentDivision = division;
    currentSeason = season;
    document.getElementById('seasonSelect').value = season;
    if (createdId) {
      currentSelectedTeamId = createdId;
      window.currentSelectedTeamId = createdId;
    }
    await initSystem();
  } else {
    alert('❌ 新增球隊失敗: ' + (res && res.message ? res.message : ''));
  }
}

// --- 建立帳號 (自動產生 P-XXXXXX)、背號設定與挑選已建帳號登錄本隊 ---
function openCreateAccountModal() {
  const teamSel = document.getElementById('newAccTeamId');
  const teamsList = globalData.teams || [];
  teamSel.innerHTML = `<option value="">-- 僅建立帳號，暫不指定球隊 --</option>` + teamsList.map(t =>
    `<option value="${t.team_id}">${t.team_name} (${t.division})</option>`
  ).join('');
  if (currentSelectedTeamId) teamSel.value = currentSelectedTeamId;

  document.getElementById('newAccPlayerName').value = '';
  document.getElementById('newAccAccount').value = '';
  document.getElementById('newAccPassword').value = '';
  document.getElementById('newAccNumber').value = '';
  document.getElementById('newAccPosition').value = '';
  document.getElementById('newAccPhone').value = '';
  document.getElementById('newAccEmail').value = '';
  document.getElementById('newAccNote').value = '';
  document.getElementById('newAccEnrollNow').checked = Boolean(currentSelectedTeamId);

  document.getElementById('createAccountModal').classList.remove('hidden');
  document.getElementById('createAccountModal').classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeCreateAccountModal() {
  document.getElementById('createAccountModal').classList.add('hidden');
  document.getElementById('createAccountModal').classList.remove('flex');
}

async function submitCreateUserAccount() {
  const playerName = document.getElementById('newAccPlayerName').value.trim();
  const customAccount = document.getElementById('newAccAccount').value.trim();
  const password = document.getElementById('newAccPassword').value.trim();
  const teamId = document.getElementById('newAccTeamId').value.trim();
  const numberVal = document.getElementById('newAccNumber')?.value.trim() || '';
  const roleLevel = document.getElementById('newAccRoleLevel').value;
  const roleType = document.getElementById('newAccRoleType').value;
  const position = document.getElementById('newAccPosition').value.trim();
  const batThrow = document.getElementById('newAccBatThrow').value;
  const phone = document.getElementById('newAccPhone').value.trim();
  const email = document.getElementById('newAccEmail').value.trim();
  const note = document.getElementById('newAccNote').value.trim();
  const enrollNow = document.getElementById('newAccEnrollNow').checked && Boolean(teamId);

  if (!playerName && !customAccount) {
    alert('請至少填寫中文姓名或登入帳號');
    return;
  }

  const res = await BBTApi.createUserAccount({
    player_name: playerName,
    ...(customAccount ? { account: customAccount } : {}),
    ...(password ? { password: password } : {}),
    team_id: teamId,
    number: numberVal,
    role_level: roleLevel,
    role_type: roleType,
    position,
    bat_throw: batThrow,
    phone,
    email,
    note,
    enroll_in_roster: enrollNow,
    is_active: true
  });

  if (res && res.result === 'ok') {
    if (enrollNow && teamId && numberVal && typeof BBTApi.saveRoster === 'function') {
      await BBTApi.saveRoster({
        team_id: teamId,
        user_id: res.user_id,
        player_name: playerName || customAccount || res.user_id,
        number: numberVal,
        role_type: roleType,
        position,
        bat_throw: batThrow,
        phone,
        status: 'approved'
      });
    }
    alert(`✅ 帳號建立成功！
自動產生代號 (user_id)：${res.user_id}
登入帳號：${res.account}`);
    closeCreateAccountModal();
    await initSystem();
  } else {
    alert('❌ 建立帳號失敗: ' + (res && res.message ? res.message : ''));
  }
}

function isSystemAdminAccount(userObj = {}) {
  const roleOverrides = typeof BBTAuth !== 'undefined'
    ? JSON.parse(localStorage.getItem(BBTAuth.ROLE_OVERRIDE_KEY) || '{}')
    : {};
  const uid = String(userObj.user_id || '').trim();
  const account = String(userObj.account || '').trim().toLowerCase();
  const globalRole = String(userObj.global_role || '').trim().toLowerCase();
  const role = String(userObj.role || roleOverrides[uid] || '').trim().toLowerCase();

  return (
    globalRole === 'super_admin' ||
    role === 'super_admin' ||
    account === 'bbtadmin'
  );
}

function openEnrollExistingModal() {
  if (!currentSelectedTeamId) {
    alert('請先選擇目標球隊');
    return;
  }
  renderAvailableUsersForEnrollment('enrollExistingUserSelect', currentSelectedTeamId);
  document.getElementById('enrollNumber').value = '';
  document.getElementById('enrollPosition').value = '';
  document.getElementById('enrollExistingModal').classList.remove('hidden');
  document.getElementById('enrollExistingModal').classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeEnrollExistingModal() {
  document.getElementById('enrollExistingModal').classList.add('hidden');
  document.getElementById('enrollExistingModal').classList.remove('flex');
}

function isInactiveRosterStatus_(statusVal) {
  const s = String(statusVal || '').trim().toLowerCase();
  return ['inactive', 'released', 'left', 'retired', 'fa', '離隊', '停用', '釋出'].includes(s);
}

function isApprovedFaToTargetTeam_(userId, targetTeamId) {
  const uid = String(userId || '').trim();
  const tid = String(targetTeamId || '').trim();
  if (!uid || !tid) return false;

  const targetTeam = (globalData.teams || []).find(t => String(t.team_id).trim() === tid);
  const tname = targetTeam ? String(targetTeam.team_name || '').trim() : '';

  return (globalData.transactions || []).some(tx => {
    if (String(tx.user_id || '').trim() !== uid) return false;
    const typeStr = String(tx.tx_type || '').trim().toUpperCase();
    if (!typeStr.includes('FA')) return false;

    const statusStr = String(tx.admin_status || '').trim().toLowerCase();
    const isApproved = ['approved', '已核准', '核准', '通過'].includes(statusStr);
    if (!isApproved) return false;

    const toTeam = String(tx.to_team_id || '').trim();
    const toTeamName = String(tx.to_team_name || '').trim();
    return toTeam === tid || (tname && (toTeam === tname || toTeamName === tname));
  });
}

function renderAvailableUsersForEnrollment(selectId, teamId) {
  const selectEl = document.getElementById(selectId);
  if (!selectEl) return;

  const targetTeamId = String(teamId || '').trim();
  const allUsers = globalData.users || [];
  const allRoster = globalData.roster || [];

  const enrolledInCurrentTeamIds = new Set();
  const activeInOtherTeamIds = new Set();

  allRoster.forEach(r => {
    const uid = String(r.user_id || '').trim();
    const rTeamId = String(r.team_id || '').trim();
    if (!uid) return;

    if (rTeamId === targetTeamId && !isInactiveRosterStatus_(r.status)) {
      enrolledInCurrentTeamIds.add(uid);
    } else if (rTeamId && rTeamId !== targetTeamId && !isInactiveRosterStatus_(r.status)) {
      activeInOtherTeamIds.add(uid);
    }
  });

  const candidates = allUsers.filter(u => {
    const uid = String(u.user_id || '').trim();
    if (!uid) return false;
    if (enrolledInCurrentTeamIds.has(uid)) return false;
    if (isSystemAdminAccount(u)) return false;

    const active =
      u.is_active === true ||
      u.is_active === undefined ||
      String(u.is_active).toUpperCase() === 'TRUE' ||
      String(u.is_active) === '1';
    if (!active) return false;

    if (activeInOtherTeamIds.has(uid)) {
      return isApprovedFaToTargetTeam_(uid, targetTeamId);
    }

    return true;
  });

  if (candidates.length === 0) {
    selectEl.innerHTML = `<option value="">-- 目前無可登錄的已建帳號（他隊現役球員需先離隊或確定 FA 至本隊） --</option>`;
    return;
  }

  selectEl.innerHTML =
    `<option value="">-- 請選擇已建帳號 --</option>` +
    candidates.map(u => {
      const nameLabel = u.player_name || u.account || u.user_id;
      const faTag = activeInOtherTeamIds.has(String(u.user_id).trim()) ? ' · FA確定入隊' : '';
      return `<option value="${u.user_id}">${nameLabel} (${u.user_id} / 帳號: ${u.account}${faTag})</option>`;
    }).join('');
}

async function enrollExistingUserToTeam() {
  const userId = document.getElementById('enrollExistingUserSelect').value.trim();
  const numberVal = document.getElementById('enrollNumber').value.trim();
  const roleType = document.getElementById('enrollRoleType').value;
  const positionVal = document.getElementById('enrollPosition').value.trim();

  if (!currentSelectedTeamId) { alert('請先選擇目標球隊'); return; }
  if (!userId) { alert('請先選擇要登錄的帳號'); return; }

  const matchedUser = (globalData.users || []).find(u => String(u.user_id).trim() === userId) || {};
  const playerName = matchedUser.player_name || matchedUser.account || userId;

  const res = await BBTApi.saveRoster({
    team_id: currentSelectedTeamId,
    user_id: userId,
    player_name: playerName,
    number: numberVal,
    role_type: roleType,
    position: positionVal || matchedUser.position || '',
    bat_throw: matchedUser.bat_throw || '',
    phone: matchedUser.phone || '',
    status: 'approved'
  });

  if (res && res.result === 'ok') {
    alert(`✅ 已將 ${playerName} (${userId}) 登錄至本隊！`);
    closeEnrollExistingModal();
    await initSystem();
  } else {
    alert('❌ 登錄本隊失敗: ' + (res && res.message ? res.message : ''));
  }
}

// --- 精準依 roster_id 編輯球員（異動） ---
function openEditRosterModal(userId, rosterId = '') {
  if (!currentSelectedTeamId) {
    alert('請先選擇球隊');
    return;
  }

  const teamUserRows = (globalData.roster || []).filter(
    r => String(r.team_id) === String(currentSelectedTeamId) && String(r.user_id) === String(userId)
  );
  const pObj = rosterId
    ? teamUserRows.find(r => String(r.roster_id || '') === String(rosterId))
    : teamUserRows[0];

  if (!pObj) return;

  const modalEl = document.getElementById('editRosterModal');
  if (modalEl) {
    const titleEl = modalEl.querySelector('h3');
    if (titleEl) titleEl.innerText = '編輯球員';
    const btns = modalEl.querySelectorAll('button');
    const saveBtn = Array.from(btns).find(b => b.textContent && b.textContent.includes('儲存'));
    if (saveBtn) saveBtn.innerText = '儲存';
  }

  const hiddenRosterIdEl = document.getElementById('editRosterId');
  if (hiddenRosterIdEl) {
    hiddenRosterIdEl.value = pObj.roster_id || '';
  }
  window.__editingRosterId = pObj.roster_id || '';

  document.getElementById('editRosterUserId').value = pObj.user_id;
  document.getElementById('editRosterPlayerName').value = pObj.player_name || '';
  document.getElementById('editRosterNameDisplay').value = `${pObj.player_name || pObj.user_id} (${pObj.user_id})`;
  document.getElementById('editRosterNumber').value = pObj.number !== undefined && pObj.number !== null ? String(pObj.number) : '';
  document.getElementById('editRosterRoleType').value = pObj.role_type || 'player';
  document.getElementById('editRosterPosition').value = pObj.position || '';
  document.getElementById('editRosterStatus').value = pObj.status || 'approved';

  modalEl.classList.remove('hidden');
  modalEl.classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeEditRosterModal() {
  window.__editingRosterId = '';
  const hiddenRosterIdEl = document.getElementById('editRosterId');
  if (hiddenRosterIdEl) hiddenRosterIdEl.value = '';
  document.getElementById('editRosterModal').classList.add('hidden');
  document.getElementById('editRosterModal').classList.remove('flex');
}

async function submitEditRoster() {
  const userId = document.getElementById('editRosterUserId').value.trim();
  const playerName = document.getElementById('editRosterPlayerName').value.trim();
  const numberVal = document.getElementById('editRosterNumber').value.trim();
  const roleType = document.getElementById('editRosterRoleType').value;
  const positionVal = document.getElementById('editRosterPosition').value.trim();
  const statusVal = document.getElementById('editRosterStatus').value;
  const targetRosterId =
    document.getElementById('editRosterId')?.value.trim() ||
    window.__editingRosterId ||
    '';

  if (!currentSelectedTeamId || !userId) return;

  const existing = (globalData.roster || []).find(r => {
    if (String(r.team_id) !== String(currentSelectedTeamId)) return false;
    if (targetRosterId) return String(r.roster_id || '') === targetRosterId;
    return String(r.user_id) === userId;
  }) || {};

  const resolvedRosterId = targetRosterId || existing.roster_id || '';

  const res = await BBTApi.saveRoster({
    ...(resolvedRosterId ? { roster_id: resolvedRosterId } : {}),
    team_id: currentSelectedTeamId,
    user_id: userId,
    player_name: playerName || existing.player_name || userId,
    number: numberVal,
    role_type: roleType,
    position: positionVal,
    bat_throw: existing.bat_throw || '',
    phone: existing.phone || '',
    status: statusVal
  });

  if (res && res.result === 'ok') {
    alert(`✅ 已儲存 ${playerName || userId} 的異動資料${numberVal ? `（#${numberVal}）` : ''}！`);
    closeEditRosterModal();
    await initSystem();
  } else {
    alert('❌ 儲存失敗: ' + (res && res.message ? res.message : ''));
  }
}

// --- 桌機版左側聯盟球隊清單 ---
function renderTeamSidebar(searchKeyword = '') {
  const container = document.getElementById('teamSidebarContainer');
  const isAllDiv = currentDivision === 'ALL';

  const filtered = globalData.teams.filter(t => {
    const matchDiv = isAllDiv || String(t.division || '').trim() === currentDivision;
    const matchKey = !searchKeyword || String(t.team_name || '').includes(searchKeyword);
    return matchDiv && matchKey;
  });

  document.getElementById('teamCountBadge').innerText = isAllDiv
    ? `全聯盟 · ${filtered.length} 隊`
    : `${currentDivision} · ${filtered.length} 隊`;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs">目前尚無符合的球隊，可點選上方「+ 新增球隊」</div>`;
    return;
  }

  const renderCard = (t) => {
    const isSelected = String(t.team_id) === String(currentSelectedTeamId);
    const cardStyle = isSelected
      ? 'bg-slate-900 text-white border-2 border-emerald-500 shadow-md'
      : 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-900';

    return `
      <div onclick="selectTeam('${t.team_id}')" class="team-card p-2.5 ${cardStyle} rounded-xl cursor-pointer transition flex items-center justify-between">
        <div class="flex items-center space-x-3 min-w-0">
          ${buildTeamLogoHtml(t, 'w-10 h-10 text-xs')}
          <div class="font-black text-sm truncate whitespace-nowrap">${t.team_name}</div>
        </div>
        <i data-lucide="chevron-right" class="w-4 h-4 shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-300'}"></i>
      </div>
    `;
  };

  if (isAllDiv) {
    const grouped = groupTeamsByDivision(filtered);
    container.innerHTML = grouped.map(grp => `
      <div class="space-y-1.5 pt-1 first:pt-0">
        <div class="px-1 flex items-center justify-between text-[11px] font-black text-slate-400 whitespace-nowrap">
          <span>${grp.division}組</span>
          <span>${grp.teams.length} 隊</span>
        </div>
        <div class="space-y-1.5">
          ${grp.teams.map(renderCard).join('')}
        </div>
      </div>
    `).join('');
  } else {
    container.innerHTML = filtered.map(renderCard).join('');
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function selectTeam(teamId) {
  if (currentUser && currentUser.role !== 'super_admin' && String(teamId) !== String(currentUser.team_id)) {
    return;
  }

  currentSelectedTeamId = teamId;
  window.currentSelectedTeamId = teamId;
  renderTeamSidebar(document.getElementById('teamSearchInput')?.value || '');

  const team = (globalData.teams || []).find(t => String(t.team_id) === String(teamId));
  if (!team) {
    showKpiOverview();
    return;
  }

  renderOverviewKpiBoard();

  document.getElementById('teamTitle').innerText = team.team_name;
  document.getElementById('teamDivisionBadge').innerText = team.division || '大聯盟組';
  document.getElementById('teamIdBadge').innerText = team.team_id;
  document.getElementById('teamIntroText').innerText = team.intro || '尚未填寫球隊介紹。';
  document.getElementById('coachText').innerText = team.coach || '—';
  document.getElementById('contactText').innerText = `${team.contact_name || '—'} (${team.contact_phone || ''})`;

  const teamNameStr = String(team.team_name || '').trim();
  const fallbackChar = teamNameStr.substring(0, 1) || 'B';
  const logoPath = `logo/${team.team_id}.png`;

  const logoContainer = document.getElementById('teamLogoContainer');
  if (logoContainer) {
    logoContainer.innerHTML = `
      <img src="${logoPath}" alt="${team.team_name}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <span style="display:none;" class="w-full h-full items-center justify-center">${fallbackChar}</span>
    `;
  }

  if (document.getElementById('editTeamIntro')) document.getElementById('editTeamIntro').value = team.intro || '';
  if (document.getElementById('editTeamContact')) document.getElementById('editTeamContact').value = team.contact_name || '';
  if (document.getElementById('editTeamPhone')) document.getElementById('editTeamPhone').value = team.contact_phone || '';

  syncPersonalHeaderAndLayout_();
  renderRosterTable();
  renderAnnouncements();
  renderTransactions(); // <-- 換隊時立刻更新本隊與他隊已核准 FA
  loadRemoteScheduleOptions();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateTeamPlayerSelects() {
  const editRecordId = document.getElementById('attEditRecordId').value;
  const attUserSelect = document.getElementById('attUserSelect');
  const teamRoster = globalData.roster.filter(r => String(r.team_id) === String(currentSelectedTeamId));

  if (editRecordId) {
    const attObj = globalData.attendance.find(a => String(a.att_id) === String(editRecordId));
    if (attObj) {
      const pObj = teamRoster.find(p => String(p.user_id) === String(attObj.user_id));
      const pName = pObj ? `#${pObj.number || '—'} ${pObj.player_name} (${pObj.position || '球員'})` : attObj.user_id;

      attUserSelect.innerHTML = `<option value="${attObj.user_id}" selected>${pName}</option>`;
      attUserSelect.disabled = true;
      return;
    }
  }

  if (currentUser && currentUser.role === 'player') {
    const selfObj = teamRoster.find(p => String(p.user_id) === String(currentUser.user_id));
    const selfLabel = selfObj
      ? `#${selfObj.number || '—'} ${selfObj.player_name} (${selfObj.position || '球員'})`
      : `${currentUser.name}`;
    attUserSelect.innerHTML = `<option value="${currentUser.user_id}" selected>${selfLabel}</option>`;
    attUserSelect.disabled = true;
  } else {
    attUserSelect.disabled = false;
    const selectedGameId = document.getElementById('attGameSelect') ? document.getElementById('attGameSelect').value : '';
    let availablePlayers = teamRoster;

    if (selectedGameId) {
      const alreadyReportedUserIds = new Set();
      globalData.attendance
        .filter(att => String(att.game_id) === String(selectedGameId) && String(att.team_id) === String(currentSelectedTeamId))
        .forEach(att => alreadyReportedUserIds.add(String(att.user_id)));

      availablePlayers = teamRoster.filter(p => !alreadyReportedUserIds.has(String(p.user_id)));
    }

    attUserSelect.innerHTML = availablePlayers.length > 0
      ? availablePlayers.map(p => `<option value="${p.user_id}">#${p.number || '—'} ${p.player_name} (${p.position || '球員'})</option>`).join('')
      : `<option value="">此場次該球隊所有球員皆已完成回報</option>`;
  }

  const faUserSelect = document.getElementById('faUserSelect');
  const isSuperAdmin = Boolean(currentUser && currentUser.role === 'super_admin');
  const selfUserId = String(currentUser?.user_id || '').trim();
  const selfRosterObj = teamRoster.find(p => String(p.user_id).trim() === selfUserId)
    || (globalData.roster || []).find(r => String(r.user_id).trim() === selfUserId)
    || {};
  const selfName = selfRosterObj.player_name || currentUser?.name || currentUser?.account || selfUserId || '目前登入球員';
  const selfNumber = selfRosterObj.number ? `#${selfRosterObj.number} ` : '';
  const selfPos = selfRosterObj.position ? ` (${selfRosterObj.position})` : '';

  const hideFaSelectAndShowBadge_ = (modalEl) => {
    if (!modalEl) return;
    if (faUserSelect) {
      faUserSelect.innerHTML = `<option value="${selfUserId}" selected>${selfNumber}${selfName}${selfPos}</option>`;
      faUserSelect.value = selfUserId;
      faUserSelect.disabled = true;
    }

    const allSelects = Array.from(modalEl.querySelectorAll('select'));
    allSelects.forEach(sel => {
      if (sel.id === 'faFlowModeSelect') return;
      const optTexts = Array.from(sel.options || []).map(o => o.text || '');
      const isPlayerSelect =
        sel.id === 'faUserSelect' ||
        sel.name === 'faUserSelect' ||
        optTexts.some(t => t.includes('陳澤宇') || t.includes('王韶文') || t.includes('(球員)') || t.includes('(C)'));
      if (isPlayerSelect) {
        const wrapper = sel.closest('.mb-3, .mb-4, .space-y-1, .form-group') || sel.parentElement;
        if (wrapper && wrapper !== modalEl) {
          wrapper.style.display = 'none';
          wrapper.classList.add('hidden');
        } else {
          sel.style.display = 'none';
          sel.classList.add('hidden');
        }
        const prevLabel = wrapper ? wrapper.previousElementSibling : sel.previousElementSibling;
        if (prevLabel && prevLabel.tagName === 'LABEL' && prevLabel.textContent.includes('選擇球員')) {
          prevLabel.style.display = 'none';
          prevLabel.classList.add('hidden');
        }
      }
    });

    let badge = document.getElementById('faSelfPlayerBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'faSelfPlayerBadge';
      badge.className = 'mb-3 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs';
      const flowWrap = document.getElementById('faFlowModeSelect')?.closest('div');
      const noteEl = document.getElementById('faNote');
      const anchor = flowWrap || (noteEl ? noteEl.parentElement : null);
      if (anchor && anchor.parentElement) {
        anchor.parentElement.insertBefore(badge, anchor);
      } else {
        modalEl.appendChild(badge);
      }
    }
    badge.style.display = 'flex';
    badge.classList.remove('hidden');
    badge.innerHTML = `
      <span class="font-bold text-slate-500">宣告球員（本人）</span>
      <span class="font-black text-emerald-900">${selfNumber}${selfName}${selfPos}</span>
    `;
  };

  const modalEl = document.getElementById('faApplyModal');
  if (!isSuperAdmin && selfUserId) {
    hideFaSelectAndShowBadge_(modalEl);
  } else if (faUserSelect) {
    const selectContainer = faUserSelect.closest('div');
    if (selectContainer) {
      selectContainer.style.display = '';
      selectContainer.classList.remove('hidden');
    }
    const existingBadge = document.getElementById('faSelfPlayerBadge');
    if (existingBadge) existingBadge.remove();

    const alreadyFaUserIds = new Set();
    globalData.transactions
      .filter(tx => String(tx.tx_type).includes('FA'))
      .forEach(tx => alreadyFaUserIds.add(String(tx.user_id)));

    const availableFaPlayers = teamRoster.filter(p => !alreadyFaUserIds.has(String(p.user_id)));
    faUserSelect.disabled = false;
    faUserSelect.innerHTML = availableFaPlayers.length > 0
      ? availableFaPlayers.map(p => {
          const displayName = p.number ? `#${p.number} ${p.player_name}` : p.player_name;
          return `<option value="${p.user_id}">${displayName} (${p.position || '球員'})</option>`;
        }).join('')
      : `<option value="">目前無可宣告 FA 之球員 (已宣告或無符合名單)</option>`;
  }
}

function parseScheduleDate_(rawDate) {
  if (!rawDate) return null;
  if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
    return new Date(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate());
  }
  const str = String(rawDate).trim();
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    return new Date(Number(ymdMatch[1]), Number(ymdMatch[2]) - 1, Number(ymdMatch[3]));
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

function getCurrentWeekMonday_() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
}

function isTeamInGame_(game, teamObj) {
  if (!teamObj) return true;
  const teamName = String(teamObj.team_name || '').trim().toLowerCase();
  const teamId = String(teamObj.team_id || '').trim().toLowerCase();
  const home = String(game.home_team || '').trim().toLowerCase();
  const away = String(game.away_team || '').trim().toLowerCase();
  const homeId = String(game.home_team_id || '').trim().toLowerCase();
  const awayId = String(game.away_team_id || '').trim().toLowerCase();

  return (
    (teamName && (home.includes(teamName) || away.includes(teamName))) ||
    (teamId && (homeId === teamId || awayId === teamId))
  );
}

function isDivisionMatch_(game, activeDiv) {
  if (!activeDiv || activeDiv === 'ALL') return true;
  const cat = String(game.category || game.league_type || game.division || '').trim().toLowerCase();
  if (!cat) return true;
  return (
    cat.includes(String(activeDiv).toLowerCase()) ||
    (activeDiv === '大聯盟' && cat.includes('major')) ||
    (activeDiv === '小聯盟' && cat.includes('minor')) ||
    (activeDiv === '育成組' && (cat.includes('rookie') || cat.includes('dev')))
  );
}

async function loadRemoteScheduleOptions() {
  const selectEl = document.getElementById('attGameSelect');
  const filterSelect = document.getElementById('filterAttendanceGameSelect');
  const batchGameSelect = document.getElementById('batchGameSelect');

  if (!currentSelectedTeamId) return;

  const isEditingExistingAtt = Boolean(document.getElementById('attEditRecordId')?.value);
  if (selectEl && !isEditingExistingAtt) {
    selectEl.innerHTML = `<option value="">正在從遠端 Games 賽事表載入賽程...</option>`;
  }

  const res = await BBTApi.getRemoteSchedule(REMOTE_SCHEDULE_SHEET_ID, 'Games');

  if (res && res.result === 'ok' && Array.isArray(res.schedule) && res.schedule.length > 0) {
    const currentTeam = (globalData.teams || []).find(
      t => String(t.team_id) === String(currentSelectedTeamId)
    );
    const teamName = currentTeam ? String(currentTeam.team_name).trim() : '';
    const activeDiv = (currentDivision && currentDivision !== 'ALL')
      ? currentDivision
      : String(currentTeam?.division || '').trim();

    const weekMonday = getCurrentWeekMonday_();
    const isManagerRole = Boolean(
      currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'team_admin')
    );

    res.schedule.forEach(g => {
      const valId = String(g.game_id || '').trim();
      if (!valId) return;

      const home = String(g.home_team || '').trim();
      const away = String(g.away_team || '').trim();
      const opponent = teamName
        ? (home.toLowerCase() === teamName.toLowerCase()
            ? away
            : (away.toLowerCase() === teamName.toLowerCase() ? home : `${home} vs ${away}`))
        : `${home} vs ${away}`;

      let dateStr = '';
      const parsedDate = parseScheduleDate_(g.date);
      if (parsedDate) {
        dateStr = `${String(parsedDate.getMonth() + 1).padStart(2, '0')}/${String(parsedDate.getDate()).padStart(2, '0')}`;
      } else if (g.date) {
        dateStr = String(g.date).split('T')[0];
      }

      let timeStr = '';
      if (g.time) {
        const tStr = String(g.time).trim();
        if (tStr.includes('1899') || tStr.includes('1900')) {
          const dt = new Date(g.time);
          if (!isNaN(dt.getTime())) {
            timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
          }
        } else if (tStr.includes(' ')) {
          timeStr = tStr.split(' ').pop().substring(0, 5);
        } else {
          timeStr = tStr.substring(0, 5);
        }
      }

      const dateTimeDisplay = timeStr ? `${dateStr} ${timeStr}` : dateStr;
      globalGameCache[valId] = `[${dateTimeDisplay}] vs ${opponent}`;
    });

    const teamGames = res.schedule.filter(g => {
      if (!String(g.game_id || '').trim()) return false;
      return isTeamInGame_(g, currentTeam) && isDivisionMatch_(g, activeDiv);
    });

    const upcomingGames = teamGames.filter(g => {
      const gDate = parseScheduleDate_(g.date);
      if (!gDate) return true;
      return gDate >= weekMonday;
    });

    const historyGames = isManagerRole
      ? teamGames.filter(g => {
          const gDate = parseScheduleDate_(g.date);
          return gDate && gDate < weekMonday;
        })
      : [];

    const buildGroupedOptionsHtml = (placeholderText) => {
      let html = placeholderText ? `<option value="">${placeholderText}</option>` : '';

      if (upcomingGames.length > 0) {
        html += `<optgroup label="本週（含）起對戰賽事">` + upcomingGames.map(g => {
          const id = String(g.game_id).trim();
          return `<option value="${id}">${globalGameCache[id] || id}</option>`;
        }).join('') + `</optgroup>`;
      } else {
        html += `<option value="" disabled>本週（含）起暫無該隊對戰賽事</option>`;
      }

      if (historyGames.length > 0) {
        html += `<optgroup label="歷史賽事（管理者修正出勤）">` + historyGames.map(g => {
          const id = String(g.game_id).trim();
          return `<option value="${id}">【歷史修正】${globalGameCache[id] || id}</option>`;
        }).join('') + `</optgroup>`;
      }

      return html;
    };

    if (selectEl && !isEditingExistingAtt) {
      selectEl.innerHTML = buildGroupedOptionsHtml('');
      const firstValidOpt = selectEl.querySelector('option[value]:not([value=""])');
      if (firstValidOpt) selectEl.value = firstValidOpt.value;
    }

    if (batchGameSelect) {
      const prevBatchVal = batchGameSelect.value;
      batchGameSelect.innerHTML = buildGroupedOptionsHtml('-- 請選擇比賽場次 --');
      if (prevBatchVal && batchGameSelect.querySelector(`option[value="${prevBatchVal}"]`)) {
        batchGameSelect.value = prevBatchVal;
      }
    }

    if (filterSelect) {
      const prevFilterVal = filterSelect.value;
      let filterHtml = `<option value="ALL">-- 顯示全部賽事場次 --</option>`;
      if (upcomingGames.length > 0) {
        filterHtml += `<optgroup label="本週（含）起對戰賽事">` + upcomingGames.map(g => {
          const id = String(g.game_id).trim();
          return `<option value="${id}">${globalGameCache[id] || id}</option>`;
        }).join('') + `</optgroup>`;
      }
      if (historyGames.length > 0) {
        filterHtml += `<optgroup label="歷史賽事（管理者修正出勤）">` + historyGames.map(g => {
          const id = String(g.game_id).trim();
          return `<option value="${id}">【歷史修正】${globalGameCache[id] || id}</option>`;
        }).join('') + `</optgroup>`;
      }
      filterSelect.innerHTML = filterHtml;
      if (prevFilterVal && filterSelect.querySelector(`option[value="${prevFilterVal}"]`)) {
        filterSelect.value = prevFilterVal;
      }
    }

    updateTeamPlayerSelects();
    renderAttendanceTable();
  } else {
    if (selectEl && !isEditingExistingAtt) {
      selectEl.innerHTML = `<option value="">⚠️ 無法讀取遠端賽事資料</option>`;
    }
  }
}

function renderAttendanceTable() {
  const tbody = document.getElementById('attendanceTableBody');
  if (!currentSelectedTeamId) return;

  const filterSelect = document.getElementById('filterAttendanceGameSelect');
  const selectedGameFilter = filterSelect ? filterSelect.value : 'ALL';

  let list = globalData.attendance.filter(att => String(att.team_id) === String(currentSelectedTeamId));
  if (selectedGameFilter !== 'ALL') {
    list = list.filter(att => String(att.game_id) === String(selectedGameFilter));
  }

  const teamRoster = globalData.roster.filter(r => String(r.team_id) === String(currentSelectedTeamId));
  const totalRosterCount = teamRoster.length;

  let attendingCount = 0;
  let leaveCount = 0;
  let subCount = 0;

  if (selectedGameFilter !== 'ALL') {
    const gameAtts = globalData.attendance.filter(att => String(att.team_id) === String(currentSelectedTeamId) && String(att.game_id) === String(selectedGameFilter));
    attendingCount = gameAtts.filter(a => a.status === 'attending').length;
    leaveCount = gameAtts.filter(a => a.status === 'leave').length;
    subCount = gameAtts.filter(a => a.status === 'sub').length;
  } else {
    attendingCount = list.filter(a => a.status === 'attending').length;
    leaveCount = list.filter(a => a.status === 'leave').length;
    subCount = list.filter(a => a.status === 'sub').length;
  }

  const reportedSet = new Set();
  if (selectedGameFilter !== 'ALL') {
    globalData.attendance
      .filter(att => String(att.team_id) === String(currentSelectedTeamId) && String(att.game_id) === String(selectedGameFilter))
      .forEach(att => reportedSet.add(String(att.user_id)));
  } else {
    list.forEach(att => reportedSet.add(String(att.user_id)));
  }
  const unreportedCount = Math.max(0, totalRosterCount - reportedSet.size);

  document.getElementById('statTotalRoster').innerText = totalRosterCount;
  document.getElementById('statAttending').innerText = attendingCount;
  document.getElementById('statLeave').innerText = leaveCount;
  document.getElementById('statSub').innerText = subCount;
  document.getElementById('statUnreported').innerText = unreportedCount;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">目前選擇的場次尚無球員出勤與請假紀錄</td></tr>`;
    return;
  }

  const isAdminRole = currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'team_admin');

  tbody.innerHTML = list.map(att => {
    const pObj = globalData.roster.find(r => String(r.user_id) === String(att.user_id));
    const displayName = pObj ? `${pObj.player_name} (#${pObj.number || '—'})` : att.user_id;
    const gameDisplay = globalGameCache[String(att.game_id)] || att.game_id;

    let statusBadge = '<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap">確認出席</span>';
    if (att.status === 'leave') statusBadge = '<span class="bg-rose-100 text-rose-800 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap">缺席請假</span>';
    if (att.status === 'sub') statusBadge = '<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap">候補支援</span>';

    const isSelfRecord = currentUser && String(att.user_id) === String(currentUser.user_id);
    let actionButtonsHtml = '<span class="text-slate-300 text-[10px]">—</span>';
    if (isAdminRole) {
      actionButtonsHtml = `
        <button onclick="editAttendance('${att.att_id}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold px-2.5 py-1 rounded-lg transition whitespace-nowrap">修改</button>
        <button onclick="deleteAttendance('${att.att_id}')" class="bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold px-2.5 py-1 rounded-lg transition whitespace-nowrap">刪除</button>
      `;
    } else if (isSelfRecord) {
      actionButtonsHtml = `
        <button onclick="editAttendance('${att.att_id}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2.5 py-1 rounded-lg transition whitespace-nowrap">修改狀態</button>
      `;
    }

    return `
      <tr>
        <td class="p-3 font-black text-slate-900 whitespace-nowrap">${gameDisplay}</td>
        <td class="p-3 font-bold whitespace-nowrap">${displayName}</td>
        <td class="p-3">${statusBadge}</td>
        <td class="p-3 text-slate-600">${att.reason || '—'}</td>
        <td class="p-3 text-slate-400 whitespace-nowrap">${att.updated_at || '—'}</td>
        <td class="p-3 text-right space-x-1.5 whitespace-nowrap">${actionButtonsHtml}</td>
      </tr>
    `;
  }).join('');
}

async function submitAttendance() {
  const att_id = document.getElementById('attEditRecordId').value;
  const game_id = document.getElementById('attGameSelect').value;
  const user_id = document.getElementById('attUserSelect').value;
  const status = document.getElementById('attStatus').value;
  const reason = document.getElementById('attReason').value;

  if (!game_id) { alert('請選擇比賽場次'); return; }
  if (!user_id && !att_id) { alert('請選擇球員'); return; }

  const finalUserId = (currentUser && currentUser.role === 'player') ? currentUser.user_id : user_id;

  const payload = { game_id, team_id: currentSelectedTeamId, user_id: finalUserId, status, reason };
  if (att_id) payload.att_id = att_id;

  const res = await BBTApi.saveAttendance(payload);
  if (res && res.result === 'ok') {
    alert('✅ 出席與請假回報已成功寫入 Google Sheets！');
    closeAttendanceModal();
    initSystem();
  } else {
    alert('❌ 回報失敗: ' + (res && res.message ? res.message : ''));
  }
}

async function editAttendance(attId) {
  const att = globalData.attendance.find(a => String(a.att_id) === String(attId));
  if (!att) return;

  document.getElementById('attEditRecordId').value = att.att_id;
  document.getElementById('attendanceModalTitle').innerText = "修改球員出勤與請假狀態";

  document.getElementById('attendanceModal').classList.remove('hidden');
  document.getElementById('attendanceModal').classList.add('flex');

  await loadRemoteScheduleOptions();
  document.getElementById('attGameSelect').value = att.game_id;

  updateTeamPlayerSelects();

  document.getElementById('attStatus').value = att.status;
  document.getElementById('attReason').value = att.reason || '';
}

async function deleteAttendance(attId) {
  if (!attId) return;
  if (!confirm('確定要刪除這筆出勤紀錄嗎？')) return;

  const res = typeof callApi === 'function'
    ? await callApi('deleteTeamAttendance', { att_id: attId })
    : { result: 'error', message: '找不到 callApi 函式' };

  if (res && res.result === 'ok') {
    globalData.attendance = (globalData.attendance || []).filter(a => String(a.att_id) !== String(attId));
    alert('✅ 已成功刪除該筆出勤紀錄');
    renderAttendanceTable();
    if (typeof initSystem === 'function') {
      await initSystem();
    }
  } else {
    alert('❌ 刪除出勤紀錄失敗：' + (res && res.message ? res.message : '未知錯誤'));
  }
}

function openBatchAttendanceModal() {
  const batchGameSelect = document.getElementById('batchGameSelect');
  const filterSelect = document.getElementById('filterAttendanceGameSelect');

  document.getElementById('batchAttendanceModal').classList.remove('hidden');
  document.getElementById('batchAttendanceModal').classList.add('flex');

  if (filterSelect && filterSelect.value !== 'ALL') {
    batchGameSelect.value = filterSelect.value;
  }
  renderBatchPlayerList();
}

function closeBatchAttendanceModal() {
  document.getElementById('batchAttendanceModal').classList.add('hidden');
  document.getElementById('batchAttendanceModal').classList.remove('flex');
}

function renderBatchPlayerList() {
  const container = document.getElementById('batchPlayerListContainer');
  const teamRoster = globalData.roster.filter(r => String(r.team_id) === String(currentSelectedTeamId));

  if (teamRoster.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-4">此球隊尚無登錄球員</div>`;
    return;
  }

  container.innerHTML = teamRoster.map(p => `
    <label class="flex items-center justify-between p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 cursor-pointer transition">
      <div class="flex items-center space-x-2.5">
        <input type="checkbox" name="batchPlayerCheck" value="${p.user_id}" class="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500">
        <span class="font-bold text-slate-800">#${p.number || '—'} ${p.player_name}</span>
      </div>
      <span class="text-[10px] text-slate-400 font-bold">${p.position || '球員'}</span>
    </label>
  `).join('');
}

function toggleBatchAll(selectVal) {
  document.querySelectorAll('input[name="batchPlayerCheck"]').forEach(cb => cb.checked = selectVal);
}

async function submitBatchAttendance() {
  const game_id = document.getElementById('batchGameSelect').value;
  const status = document.getElementById('batchStatus').value;
  const checkboxes = document.querySelectorAll('input[name="batchPlayerCheck"]:checked');

  if (!game_id) { alert('請選擇目標比賽場次'); return; }
  if (checkboxes.length === 0) { alert('請至少勾選一位球員'); return; }

  const userIds = Array.from(checkboxes).map(cb => cb.value);

  let successCount = 0;
  for (const user_id of userIds) {
    const res = await BBTApi.saveAttendance({ game_id, team_id: currentSelectedTeamId, user_id, status, reason: '批次點名登記' });
    if (res && res.result === 'ok') successCount++;
  }

  alert(`✅ 成功完成 ${successCount} 位球員的批次點名！`);
  closeBatchAttendanceModal();
  initSystem();
}

// --- 輔助函式：取得已核准 FA 目標球隊名稱 ---
function resolveApprovedFaTargetTeamName_(tx) {
  if (!tx) return '';
  const teams = globalData.teams || [];
  const toTeamId = String(tx.to_team_id || '').trim();
  const toTeamName = String(tx.to_team_name || '').trim();

  if (toTeamName) return toTeamName;

  if (toTeamId && !['FA_MARKET', 'LEAGUE_MATCH'].includes(toTeamId.toUpperCase())) {
    const byId = teams.find(t => String(t.team_id || '').trim() === toTeamId);
    if (byId && byId.team_name) return String(byId.team_name).trim();
  }

  const noteStr = String(tx.note || '').trim();
  if (noteStr) {
    // 優先抓取【...】後的隊伍名稱，或比對現有球隊名稱
    const afterBracketMatch = noteStr.match(/】\s*([^\s（(]+)$/);
    if (afterBracketMatch && afterBracketMatch[1]) {
      const candidate = afterBracketMatch[1].trim();
      const matchedTeam = teams.find(t => String(t.team_name || '').trim() === candidate);
      if (matchedTeam) return String(matchedTeam.team_name).trim();
    }
    const matchedInNote = teams.find(t => t.team_name && noteStr.includes(String(t.team_name).trim()));
    if (matchedInNote) return String(matchedInNote.team_name).trim();
  }

  return '';
}

// --- 輔助函式：判斷球員在某隊是否已 FA 審核通過（應轉入歷屆球員，不再列為現役名單） ---
function getApprovedFaForRosterRow_(rosterRow) {
  const uid = String(rosterRow?.user_id || '').trim();
  const tid = String(rosterRow?.team_id || '').trim();
  if (!uid || !tid) return null;

  const txs = globalData.transactions || [];
  const matchedFa = txs.find(tx => {
    if (!isFaRecord_(tx) || !isApprovedStatus_(tx.admin_status)) return false;
    if (String(tx.user_id || '').trim() !== uid) return false;
    const txFrom = String(tx.from_team_id || '').trim();
    const txTeam = String(tx.team_id || '').trim();
    return (!txFrom && !txTeam) || txFrom === tid || txTeam === tid;
  });

  if (!matchedFa) return null;

  return {
    tx: matchedFa,
    targetTeamName: resolveApprovedFaTargetTeamName_(matchedFa)
  };
}

function renderRosterTable() {
  const tbody = document.getElementById('rosterTableBody');
  if (!currentSelectedTeamId) return;

  const allTeamRoster = globalData.roster.filter(r => String(r.team_id) === String(currentSelectedTeamId));

  // FA 審核通過者視為該隊歷屆球員，不列入現役名單；若狀態本身已是 fa 且已核准亦排除
  const activeRoster = allTeamRoster.filter(r => {
    const rawStatus = String(r.status || '').trim().toLowerCase();
    const faInfo = getApprovedFaForRosterRow_(r);
    if (faInfo) return false;
    if (rawStatus === 'fa') return false;
    return true;
  });

  const formerRosterByFa = allTeamRoster.filter(r => {
    const rawStatus = String(r.status || '').trim().toLowerCase();
    return Boolean(getApprovedFaForRosterRow_(r)) || rawStatus === 'fa';
  });

  const filtered = currentRosterFilter === 'all'
    ? activeRoster
    : activeRoster.filter(r => String(r.role_type).toLowerCase() === currentRosterFilter);

  const rosterCountEl = document.getElementById('rosterCountText');
  if (rosterCountEl) {
    rosterCountEl.innerText = `現役 ${activeRoster.length} 人${formerRosterByFa.length > 0 ? ` · 歷屆(FA) ${formerRosterByFa.length} 人` : ''}`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">此分類目前無現役登錄人員${formerRosterByFa.length > 0 ? '（FA 審核通過人員已轉為歷屆球員）' : ''}</td></tr>`;
    return;
  }

  const canManageRoster = currentUser && (
    currentUser.role === 'super_admin' ||
    (currentUser.role === 'team_admin' && String(currentUser.team_id) === String(currentSelectedTeamId))
  );

  tbody.innerHTML = filtered.map(p => {
    const pStats = globalData.stats.find(s => String(s.user_id) === String(p.user_id) && String(s.season) === currentSeason);
    const statSummary = pStats ? `AVG .${Math.floor((pStats.h / (pStats.ab || 1)) * 1000)} / HR ${pStats.hr || 0}` : '尚無打擊紀錄';
    const isMe = currentUser && String(p.user_id) === String(currentUser.user_id);
    const safeRosterId = String(p.roster_id || '').replace(/'/g, "\\'");

    const rawStatus = String(p.status || 'approved').trim();
    const isFaStatus = rawStatus.toLowerCase() === 'fa';
    const faMatch = (globalData.transactions || []).find(
      tx => isFaRecord_(tx) && String(tx.user_id || '').trim() === String(p.user_id || '').trim()
    );
    const faTargetName = faMatch ? resolveApprovedFaTargetTeamName_(faMatch) : '';

    let statusBadgeHtml = `<span class="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2 py-0.5 rounded-full text-[10px]">${rawStatus}</span>`;
    if (isFaStatus) {
      const label = faTargetName ? `FA 至 ${faTargetName}` : 'FA';
      statusBadgeHtml = `<span class="bg-purple-50 text-purple-700 border border-purple-200 font-black px-2 py-0.5 rounded-full text-[10px]">${label}</span>`;
    }

    return `
      <tr class="hover:bg-slate-50 transition ${isMe ? 'bg-emerald-50/40' : ''}">
        <td class="p-3 font-black text-slate-900 whitespace-nowrap">${p.number !== undefined && p.number !== null && String(p.number) !== '' ? `#${p.number}` : '—'}</td>
        <td class="p-3 whitespace-nowrap">
          <div class="flex items-center gap-2">
            <button onclick="openPlayerCard('${p.user_id}')" class="font-black text-bbt-navy hover:text-emerald-600 underline decoration-emerald-400 decoration-2 underline-offset-4 flex items-center gap-1 whitespace-nowrap">
              <span>${p.player_name}</span>
              <i data-lucide="id-card" class="w-3.5 h-3.5 text-emerald-600 shrink-0"></i>
            </button>
            ${isMe ? '<span class="bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded shrink-0">本人</span>' : ''}
          </div>
        </td>
        <td class="p-3 whitespace-nowrap"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-bold text-[11px]">${p.role_type || 'player'}</span></td>
        <td class="p-3 whitespace-nowrap">${p.position || '—'}</td>
        <td class="p-3 text-slate-500 whitespace-nowrap">${p.bat_throw || '—'}</td>
        <td class="p-3 text-right font-black text-slate-800 whitespace-nowrap">${statSummary}</td>
        <td class="p-3 text-center whitespace-nowrap">${statusBadgeHtml}</td>
        <td class="p-3 text-right whitespace-nowrap">
          ${canManageRoster
            ? `<button onclick="openEditRosterModal('${p.user_id}', '${safeRosterId}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold px-2.5 py-1 rounded-lg transition whitespace-nowrap">異動</button>`
            : `<span class="text-slate-300 text-[10px]">—</span>`}
        </td>
      </tr>
    `;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- 輔助函式：格式化歷屆紀錄日期（僅保留日期，不顯示時間） ---
function formatHistoryDateTime_(rawDate, rawTime = '') {
  const dateStr = String(rawDate || '').trim();
  const timeStr = String(rawTime || '').trim();

  const extractDateOnly_ = (s) => {
    if (!s) return '';
    // 若是帶時區的 ISO 日期字串，依台灣時區萃取 YYYY/MM/DD
    if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+\-]\d{2}:?\d{2})$/i.test(s)) {
      const dt = new Date(s);
      if (!isNaN(dt.getTime())) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Taipei',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(dt);
        const y = parts.find(p => p.type === 'year')?.value || '';
        const m = parts.find(p => p.type === 'month')?.value || '';
        const d = parts.find(p => p.type === 'day')?.value || '';
        if (y && m && d) return `${y}/${m}/${d}`;
      }
    }
    // 擷取一般日期格式 YYYY/MM/DD 或 YYYY-MM-DD
    const m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) {
      return `${m[1]}/${String(m[2]).padStart(2, '0')}/${String(m[3]).padStart(2, '0')}`;
    }
    return '';
  };

  return extractDateOnly_(dateStr) || extractDateOnly_(timeStr) || '';
}

// --- 系統動作訊息框（Toast / Action Status Banner） ---
let actionToastTimer_ = null;

function ensureActionToastEl_() {
  let el = document.getElementById('bbtActionStatusToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bbtActionStatusToast';
    el.className = 'fixed bottom-5 right-5 z-[9999] max-w-sm w-auto pointer-events-none opacity-0 translate-y-2 transition-all duration-200';
    el.innerHTML = `
      <div id="bbtActionStatusToastCard" class="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl shadow-xl border text-xs font-black bg-slate-900 text-white border-slate-700">
        <span id="bbtActionStatusDot" class="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0"></span>
        <span id="bbtActionStatusText" class="leading-snug">系統運作中...</span>
      </div>
    `;
    document.body.appendChild(el);
  }
  return el;
}

function showActionStatus(message, type = 'info', autoHideMs = 2600) {
  const el = ensureActionToastEl_();
  const card = document.getElementById('bbtActionStatusToastCard');
  const dot = document.getElementById('bbtActionStatusDot');
  const text = document.getElementById('bbtActionStatusText');

  if (text) text.innerText = String(message || '系統運作中...');

  if (card && dot) {
    if (type === 'loading' || type === 'info') {
      card.className = 'flex items-center gap-2.5 px-4 py-2.5 rounded-2xl shadow-xl border text-xs font-black bg-slate-900 text-white border-emerald-500/50';
      dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0';
    } else if (type === 'success') {
      card.className = 'flex items-center gap-2.5 px-4 py-2.5 rounded-2xl shadow-xl border text-xs font-black bg-emerald-950 text-emerald-100 border-emerald-500/60';
      dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0';
    } else if (type === 'error' || type === 'warn') {
      card.className = 'flex items-center gap-2.5 px-4 py-2.5 rounded-2xl shadow-xl border text-xs font-black bg-rose-950 text-rose-100 border-rose-500/60';
      dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-400 shrink-0';
    }
  }

  el.classList.remove('opacity-0', 'translate-y-2');
  el.classList.add('opacity-100', 'translate-y-0');

  if (actionToastTimer_) {
    clearTimeout(actionToastTimer_);
    actionToastTimer_ = null;
  }

  if (autoHideMs > 0) {
    actionToastTimer_ = setTimeout(() => {
      el.classList.remove('opacity-100', 'translate-y-0');
      el.classList.add('opacity-0', 'translate-y-2');
    }, autoHideMs);
  }
}

function attachActionFeedbackHooks_() {
  if (typeof BBTApi === 'undefined' || !BBTApi || BBTApi.__toastHooked) return;
  BBTApi.__toastHooked = true;

  const actionLabels = {
    getInitData: '正在同步聯盟與球隊資料...',
    getPlayerCard: '正在讀取球員卡與歷屆紀錄...',
    getRemoteSchedule: '正在讀取遠端賽事賽程...',
    saveTeamProfile: '正在儲存球隊資料...',
    saveRoster: '正在更新球員名單與背號...',
    createUserAccount: '正在建立新帳號...',
    saveAttendance: '正在儲存出勤與請假紀錄...',
    saveAnnouncement: '正在發布公告...',
    saveTransaction: '正在送出 FA 宣告申請...',
    reviewFaTransaction: '正在處理 FA 資格審查...'
  };

  Object.keys(actionLabels).forEach(fnName => {
    if (typeof BBTApi[fnName] === 'function') {
      const origFn = BBTApi[fnName].bind(BBTApi);
      BBTApi[fnName] = async (...args) => {
        showActionStatus(actionLabels[fnName], 'loading', 0);
        try {
          const res = await origFn(...args);
          if (res && res.result === 'ok') {
            if (fnName.startsWith('save') || fnName.startsWith('create') || fnName.startsWith('review')) {
              showActionStatus('已完成系統操作並同步資料', 'success', 2400);
            } else {
              showActionStatus('資料載入完成', 'success', 1400);
            }
          } else if (res && res.result === 'error') {
            showActionStatus(res.message || '操作未完成，請稍後再試', 'error', 3200);
          } else {
            showActionStatus('系統處理完成', 'success', 1500);
          }
          return res;
        } catch (err) {
          showActionStatus('系統連線發生錯誤', 'error', 3200);
          throw err;
        }
      };
    }
  });
}

async function openPlayerCard(userId) {
  activeCardUserId = userId;
  showActionStatus('正在開啟球員卡與歷屆紀錄...', 'loading', 0);
  const cardRes = await BBTApi.getPlayerCard(userId, currentSeason);
  if (cardRes && cardRes.result === 'ok') {
    const p = cardRes.profile;
    const season = cardRes.season_stat;
    const career = cardRes.career_stat;
    const careerHistory = cardRes.career_history || [];

    document.getElementById('cardNumber').innerText = `#${p.number || '—'}`;
    document.getElementById('cardName').innerText = p.player_name || '未知球員';
    document.getElementById('cardMeta').innerText = `${cardRes.team.team_name || 'BBT聯盟'} · ${p.position || '—'} · ${p.bat_throw || '—'}`;

    const awardsContainer = document.getElementById('cardAwards');
    if (career.awards_list && career.awards_list.length > 0) {
      awardsContainer.innerHTML = career.awards_list.map(aw => `<span class="bg-amber-500/20 border border-amber-400/40 text-amber-200 text-[10px] font-bold px-2 py-0.5 rounded">🏆 ${aw.season} ${aw.title}</span>`).join('');
    } else {
      awardsContainer.innerHTML = `<span class="bg-slate-800 text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded">尚無登錄獎項</span>`;
    }

    const historyContainer = document.getElementById('cardCareerHistory');
    if (careerHistory.length > 0) {
      historyContainer.innerHTML = careerHistory.map(h => `
        <div class="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-100">
          <div>
            <span class="font-black text-slate-800">${h.team_name || h.team_id || '—'}</span>
            <span class="ml-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">${h.number ? `#${h.number}` : '背號未填'}</span>
            <span class="ml-1 text-[10px] text-slate-400">${h.event_type || ''}</span>
          </div>
          <div class="text-[10px] text-slate-400 text-right">
            <div>${h.season || ''}</div>
            <div>${formatHistoryDateTime_(h.date, h.time || h.created_at || h.updated_at || h.timestamp || h.record_time)}</div>
          </div>
        </div>
      `).join('');
    } else {
      historyContainer.innerHTML = `<div class="text-slate-400 text-center py-2">尚無歷屆紀錄</div>`;
    }

    const btnEditSelf = document.getElementById('btnCardEditSelf');
    if (currentUser && String(currentUser.user_id) === String(userId)) {
      btnEditSelf.classList.remove('hidden');
      btnEditSelf.classList.add('flex');
    } else {
      btnEditSelf.classList.add('hidden');
      btnEditSelf.classList.remove('flex');
    }

    activePlayerCardCache = { season, career };
    toggleCardStats('season');

    document.getElementById('playerCardModal').classList.remove('hidden');
    document.getElementById('playerCardModal').classList.add('flex');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } else {
    alert('無法取得球員詳細成績');
  }
}

function closePlayerCard() {
  document.getElementById('playerCardModal').classList.add('hidden');
  document.getElementById('playerCardModal').classList.remove('flex');
}

function toggleCardStats(type) {
  const data = activePlayerCardCache ? activePlayerCardCache[type] : {};
  if (type === 'season') {
    document.getElementById('stat-avg').innerText = data.ab > 0 ? (data.h / data.ab).toFixed(3).replace(/^0/, '') : '.000';
    document.getElementById('stat-hr').innerText = data.hr || '0';
    document.getElementById('stat-rbi').innerText = data.rbi || '0';
    document.getElementById('stat-ops').innerText = data.ops || '1.000';
    document.getElementById('stat-era').innerText = data.ip > 0 ? ((data.er * 7) / data.ip).toFixed(2) : '0.00';
    document.getElementById('stat-wl').innerText = `${data.w || 0}W - ${data.l || 0}L`;
    document.getElementById('stat-so').innerText = data.so || '0';
    document.getElementById('stat-fpct').innerText = '.990';
    document.getElementById('stat-err').innerText = data.e || '0';

    document.getElementById('btn-stat-season').className = "px-3 py-1 rounded-lg bg-bbt-navy text-white shadow";
    document.getElementById('btn-stat-career').className = "px-3 py-1 rounded-lg text-slate-600";
  } else {
    document.getElementById('stat-avg').innerText = data.avg || '.000';
    document.getElementById('stat-hr').innerText = data.hr || '0';
    document.getElementById('stat-rbi').innerText = data.rbi || '0';
    document.getElementById('stat-ops').innerText = '.980';
    document.getElementById('stat-era').innerText = data.era || '0.00';
    document.getElementById('stat-wl').innerText = `${data.w || 0}W - ${data.l || 0}L`;
    document.getElementById('stat-so').innerText = data.so || '0';
    document.getElementById('stat-fpct').innerText = data.fpct || '.985';
    document.getElementById('stat-err').innerText = data.e || '0';

    document.getElementById('btn-stat-career').className = "px-3 py-1 rounded-lg bg-bbt-navy text-white shadow";
    document.getElementById('btn-stat-season').className = "px-3 py-1 rounded-lg text-slate-600";
  }
}

// --- 公告上下分區：上方聯盟公告（Announcements）、下方本隊公告（Team_Announcements） ---
function renderAnnouncements() {
  const container = document.getElementById('announcementsContainer');
  if (!container) return;

  const leagueList = globalData.league_announcements || [];
  const teamList = currentSelectedTeamId
    ? (globalData.announcements || []).filter(a => String(a.team_id) === String(currentSelectedTeamId))
    : [];

  const renderAnnCards = (list, badgeText, badgeClass, emptyText) => {
    if (!list || list.length === 0) {
      return `<div class="p-3 text-center text-slate-400 text-xs bg-slate-50/70 rounded-xl border border-dashed border-slate-200">${emptyText}</div>`;
    }
    return `<div class="space-y-2">` + list.map(a => `
      <div class="p-3 rounded-xl border border-slate-200 bg-white space-y-1">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="${badgeClass} text-[10px] font-black px-2 py-0.5 rounded whitespace-nowrap shrink-0">${badgeText}</span>
            <span class="bg-slate-100 text-slate-700 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">${a.category || '公告'}</span>
            <span class="font-black text-xs sm:text-sm text-slate-900 truncate">${a.title || ''}</span>
          </div>
          <span class="text-[10px] text-slate-400 whitespace-nowrap shrink-0">${a.created_at || ''}</span>
        </div>
        <p class="text-xs text-slate-600 leading-relaxed">${a.content || ''}</p>
      </div>
    `).join('') + `</div>`;
  };

  container.innerHTML = `
    <div class="space-y-4">
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2 pb-1 border-b border-amber-200/80">
          <div class="flex items-center gap-1.5 whitespace-nowrap">
            <span class="w-2 h-2 rounded-full bg-amber-500"></span>
            <span class="text-xs font-black text-slate-900">聯盟公告</span>
            <span class="text-[11px] font-bold text-slate-400">(${leagueList.length})</span>
          </div>
          <span class="text-[10px] text-amber-700 font-bold whitespace-nowrap">全聯盟同步</span>
        </div>
        ${renderAnnCards(leagueList, '聯盟', 'bg-amber-100 text-amber-800', '目前尚無聯盟公告')}
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2 pb-1 border-b border-emerald-200/80">
          <div class="flex items-center gap-1.5 whitespace-nowrap">
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span class="text-xs font-black text-slate-900">本隊公告</span>
            <span class="text-[11px] font-bold text-slate-400">(${teamList.length})</span>
          </div>
          <span class="text-[10px] text-emerald-700 font-bold whitespace-nowrap">隊內通知</span>
        </div>
        ${renderAnnCards(teamList, '本隊', 'bg-emerald-100 text-emerald-800', '目前尚無本隊公告')}
      </div>
    </div>
  `;
}

// --- FA 審查彈窗與操作 ---
function ensureFaReviewModal_() {
  if (document.getElementById('faReviewModal')) return;

  const modal = document.createElement('div');
  modal.id = 'faReviewModal';
  modal.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-slate-900/60 p-3';
  modal.innerHTML = `
    <div class="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
      <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
        <div class="font-black text-sm flex items-center gap-1.5 whitespace-nowrap">
          <i data-lucide="shield-check" class="w-4 h-4 text-emerald-400"></i>
          <span id="faReviewModalTitle">FA 資格審查</span>
        </div>
        <button onclick="closeFaReviewModal()" class="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 whitespace-nowrap">✕</button>
      </div>
      <div class="p-4 space-y-3 text-xs overflow-y-auto">
        <div id="faReviewSummaryBox" class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-slate-700"></div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">審查決定</label>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" id="btnFaDecisionApprove" onclick="setFaReviewDecision('approved')" class="py-2 px-3 rounded-xl font-black border transition whitespace-nowrap">✓ 核准 FA</button>
            <button type="button" id="btnFaDecisionReject" onclick="setFaReviewDecision('rejected')" class="py-2 px-3 rounded-xl font-black border transition whitespace-nowrap">✕ 駁回申請</button>
          </div>
        </div>
        <div id="faTargetTeamSection" class="space-y-1">
          <label class="block font-bold text-slate-700">確定 FA 目標球隊（核准時選擇）</label>
          <select id="faTargetTeamSelect" class="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800 text-xs focus:outline-none focus:border-emerald-500"></select>
        </div>
        <div class="space-y-1.5">
          <label class="block font-bold text-slate-700">審查備註</label>
          <select id="faReviewNoteOptionSelect" onchange="handleFaReviewNoteOptionChange()" class="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-800 text-xs focus:outline-none focus:border-emerald-500">
            <option value="依球員確定的球隊">a. 依球員確定的球隊</option>
            <option value="聯盟配對的球隊">b. 聯盟配對的球隊</option>
            <option value="其它">c. 其它</option>
          </select>
          <div id="faReviewCustomNoteWrap" class="hidden pt-1">
            <input id="faReviewCustomNoteInput" type="text" placeholder="請輸入其他審查備註內容..." class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-emerald-500">
          </div>
        </div>
        <label id="faPublishAnnWrap" class="flex items-center gap-2 pt-1 cursor-pointer select-none">
          <input id="faPublishAnnCheckbox" type="checkbox" checked class="w-4 h-4 rounded text-emerald-600 border-slate-300">
          <span class="font-bold text-slate-700">核准後自動發布聯盟 FA 公告</span>
        </label>
      </div>
      <div class="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0">
        <button type="button" onclick="closeFaReviewModal()" class="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 whitespace-nowrap">取消</button>
        <button type="button" id="btnConfirmFaReview" onclick="submitFaReviewDecision()" class="px-4 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm whitespace-nowrap">確認送出</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function handleFaReviewNoteOptionChange() {
  const optVal = document.getElementById('faReviewNoteOptionSelect')?.value || '';
  const customWrap = document.getElementById('faReviewCustomNoteWrap');
  const customInput = document.getElementById('faReviewCustomNoteInput');
  if (!customWrap) return;
  if (optVal === '其它') {
    customWrap.classList.remove('hidden');
    if (customInput) customInput.focus();
  } else {
    customWrap.classList.add('hidden');
  }
}

function populateFaTargetTeamSelect_(tx) {
  const sel = document.getElementById('faTargetTeamSelect');
  if (!sel) return;
  const teams = globalData.teams || [];
  const fromTeamId = String(tx?.from_team_id || '').trim();
  const noteText = String(tx?.note || '').trim();

  let matchedTeamId = String(tx?.to_team_id || '').trim();
  if (!matchedTeamId || ['FA_MARKET', 'LEAGUE_MATCH'].includes(matchedTeamId.toUpperCase())) {
    const foundByName = teams.find(t => t.team_name && noteText.includes(String(t.team_name).trim()));
    matchedTeamId = foundByName ? String(foundByName.team_id).trim() : '';
  }

  sel.innerHTML =
    `<option value="">-- 請選擇球員確定轉入的 FA 球隊 --</option>` +
    teams.map(t => {
      const tid = String(t.team_id || '').trim();
      const isSameAsOrigin = fromTeamId && tid === fromTeamId;
      const divLabel = t.division ? ` (${t.division})` : '';
      return `<option value="${tid}" ${tid === matchedTeamId ? 'selected' : ''}>${t.team_name}${divLabel}${isSameAsOrigin ? ' · 原隊' : ''}</option>`;
    }).join('');
}

function setFaReviewDecision(decision) {
  const modal = document.getElementById('faReviewModal');
  if (!modal) return;
  modal.dataset.decision = decision;

  const approveBtn = document.getElementById('btnFaDecisionApprove');
  const rejectBtn = document.getElementById('btnFaDecisionReject');
  const publishWrap = document.getElementById('faPublishAnnWrap');
  const targetTeamSec = document.getElementById('faTargetTeamSection');

  if (decision === 'approved') {
    approveBtn.className = 'py-2 px-3 rounded-xl font-black border border-emerald-600 bg-emerald-600 text-white transition whitespace-nowrap';
    rejectBtn.className = 'py-2 px-3 rounded-xl font-black border border-slate-200 bg-white text-slate-600 hover:bg-rose-50 transition whitespace-nowrap';
    if (publishWrap) publishWrap.classList.remove('hidden');
    if (targetTeamSec) targetTeamSec.classList.remove('hidden');
  } else {
    rejectBtn.className = 'py-2 px-3 rounded-xl font-black border border-rose-600 bg-rose-600 text-white transition whitespace-nowrap';
    approveBtn.className = 'py-2 px-3 rounded-xl font-black border border-slate-200 bg-white text-slate-600 hover:bg-emerald-50 transition whitespace-nowrap';
    if (publishWrap) publishWrap.classList.add('hidden');
    if (targetTeamSec) targetTeamSec.classList.add('hidden');
  }
}

function openFaReviewModal(txId, defaultDecision = 'approved') {
  const isSuper = currentUser && currentUser.role === 'super_admin';
  if (!isSuper) {
    alert('僅聯盟總管理員可進行 FA 審查');
    return;
  }

  const tx = (globalData.transactions || []).find(t => String(t.tx_id || '').trim() === String(txId || '').trim());
  if (!tx) {
    alert('找不到該筆 FA 申請紀錄');
    return;
  }

  ensureFaReviewModal_();
  pendingReviewTxCache = tx;

  const playerLabel = formatTxPlayerName_(tx);
  const fromTeamObj = (globalData.teams || []).find(t => String(t.team_id) === String(tx.from_team_id));
  const fromTeamName = fromTeamObj ? fromTeamObj.team_name : (tx.from_team_id || '—');

  document.getElementById('faReviewSummaryBox').innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <span class="font-black text-slate-900">${playerLabel}</span>
      <span class="text-[10px] font-bold text-slate-400">${tx.tx_id}</span>
    </div>
    <div class="text-slate-600">原所屬球隊：<span class="font-bold text-slate-800">${fromTeamName}</span></div>
    <div class="text-slate-600">申請說明：${tx.note || '—'}</div>
  `;

  populateFaTargetTeamSelect_(tx);

  const noteSelect = document.getElementById('faReviewNoteOptionSelect');
  const customInput = document.getElementById('faReviewCustomNoteInput');
  if (noteSelect) {
    const rawNote = String(tx.note || '');
    if (rawNote.includes('配對')) {
      noteSelect.value = '聯盟配對的球隊';
    } else {
      noteSelect.value = '依球員確定的球隊';
    }
  }
  if (customInput) customInput.value = '';
  handleFaReviewNoteOptionChange();

  document.getElementById('faPublishAnnCheckbox').checked = true;
  setFaReviewDecision(defaultDecision);

  const modal = document.getElementById('faReviewModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeFaReviewModal() {
  const modal = document.getElementById('faReviewModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  pendingReviewTxCache = null;
}

async function submitFaReviewDecision() {
  const modal = document.getElementById('faReviewModal');
  if (!pendingReviewTxCache || !modal) return;

  const decision = modal.dataset.decision || 'approved';
  const noteOpt = document.getElementById('faReviewNoteOptionSelect')?.value || '依球員確定的球隊';
  const customNote = String(document.getElementById('faReviewCustomNoteInput')?.value || '').trim();
  const targetTeamId = String(document.getElementById('faTargetTeamSelect')?.value || '').trim();
  const targetTeamObj = (globalData.teams || []).find(t => String(t.team_id).trim() === targetTeamId);
  const targetTeamName = targetTeamObj ? targetTeamObj.team_name : '';

  if (decision === 'approved' && !targetTeamId) {
    alert('核准 FA 時請先選擇球員確定要轉入的球隊');
    return;
  }

  if (noteOpt === '其它' && !customNote) {
    alert('選擇「其它」時請填寫備註內容');
    return;
  }

  const reviewNote = noteOpt === '其它'
    ? `其它：${customNote}`
    : (decision === 'approved' && targetTeamName ? `${noteOpt}（${targetTeamName}）` : noteOpt);

  const publishAnnouncement = Boolean(document.getElementById('faPublishAnnCheckbox')?.checked);

  const submitBtn = document.getElementById('btnConfirmFaReview');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await BBTApi.reviewFaTransaction({
      tx_id: pendingReviewTxCache.tx_id,
      decision: decision,
      admin_status: decision,
      ...(decision === 'approved' ? { to_team_id: targetTeamId, to_team_name: targetTeamName } : {}),
      review_note: reviewNote,
      publish_announcement: decision === 'approved' && publishAnnouncement
    });

    if (res && res.result === 'ok') {
      alert(decision === 'approved'
        ? `✅ 已核准 FA 申請（確定轉入：${targetTeamName || targetTeamId}）！`
        : '✅ 已駁回該筆 FA 申請！');
      closeFaReviewModal();
      await initSystem();
      if (currentSelectedTeamId) {
        selectTeam(currentSelectedTeamId);
      }
    } else {
      alert('❌ 審查失敗: ' + (res && res.message ? res.message : '未知錯誤'));
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

let currentTxScopeFilter = 'all';

function setTxScopeFilter(scope) {
  currentTxScopeFilter = scope;
  ['all', 'mine', 'others_approved'].forEach(key => {
    const btn = document.getElementById('tx-scope-' + key);
    if (!btn) return;
    btn.className = key === scope
      ? 'px-2.5 py-1 rounded-lg text-[11px] font-black bg-slate-800 text-white whitespace-nowrap transition'
      : 'px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap transition';
  });
  renderTransactions();
}

function isApprovedTxStatus(statusVal) {
  const s = String(statusVal || '').trim().toLowerCase();
  return s === 'approved' || s === '已核准' || s === '核准' || s === '通過';
}

function isApprovedStatus_(statusVal) {
  const s = String(statusVal || '').trim().toLowerCase();
  return s === 'approved' || s === '已核准' || s === '核准' || s === '通過';
}

function isPendingStatus_(statusVal) {
  const s = String(statusVal || '').trim().toLowerCase();
  return !s || s === 'pending' || s === '待審核' || s === '審核中';
}

function isFaRecord_(tx) {
  const typeStr = String(tx.tx_type || '').trim().toUpperCase();
  const toTeam = String(tx.to_team_id || '').trim().toUpperCase();
  return typeStr.includes('FA') || toTeam === 'FA_MARKET';
}

function isMyTeamTx_(tx, teamObj) {
  if (!teamObj) return false;
  const tid = String(teamObj.team_id || '').trim();
  const tname = String(teamObj.team_name || '').trim();
  const candidates = [
    String(tx.from_team_id || '').trim(),
    String(tx.to_team_id || '').trim(),
    String(tx.team_id || '').trim(),
    String(tx.from_team_name || '').trim(),
    String(tx.to_team_name || '').trim()
  ];
  return candidates.some(v => v && (v === tid || (tname && v === tname)));
}

function formatTxPlayerName_(tx) {
  const pObj = (globalData.roster || []).find(r => String(r.user_id) === String(tx.user_id));
  const uObj = (globalData.users || []).find(u => String(u.user_id) === String(tx.user_id));
  if (pObj) {
    return pObj.number ? `#${pObj.number} ${pObj.player_name}` : pObj.player_name;
  }
  if (uObj && uObj.player_name) {
    return uObj.player_name;
  }
  return tx.user_id || '—';
}

function isRejectedStatus_(statusVal) {
  const s = String(statusVal || '').trim().toLowerCase();
  return ['rejected', '已駁回', '駁回', '拒絕', '已拒絕', 'denied', 'declined'].includes(s);
}

function isCompletedFaStatus_(statusVal) {
  return isApprovedStatus_(statusVal) || isRejectedStatus_(statusVal);
}

function getTxYear_(tx) {
  const raw = String(tx?.tx_date || tx?.created_at || tx?.updated_at || '').trim();
  const match = raw.match(/(\d{4})/);
  if (match) return Number(match[1]);
  const seasonMatch = String(currentSeason || '').match(/(\d{4})/);
  return seasonMatch ? Number(seasonMatch[1]) : new Date().getFullYear();
}

function hasBorrowedNextYearQuota_(tx) {
  return (
    tx?.used_next_year_quota === true ||
    String(tx?.note || '').includes('預支明年額度') ||
    String(tx?.note || '').includes('預支')
  );
}

function getPlayerFaEligibility_(userId, refDate = new Date()) {
  const uid = String(userId || '').trim();
  if (!uid) {
    return {
      canApply: false,
      hasInProgress: false,
      usedCurrentYearQuota: false,
      borrowedNextYearQuota: false,
      nextYearQuotaConsumed: false,
      reason: '無法辨識球員身分'
    };
  }

  const currentYear = refDate.getFullYear();
  const prevYear = currentYear - 1;
  const nextYear = currentYear + 1;

  const playerFaTxs = (globalData.transactions || []).filter(
    tx => isFaRecord_(tx) && String(tx.user_id || '').trim() === uid
  );

  // 1. 只要有尚未完成（非成功也非拒絕）的 FA 申請，一律鎖定
  const inProgressTx = playerFaTxs.find(tx => !isCompletedFaStatus_(tx.admin_status));
  if (inProgressTx) {
    return {
      canApply: false,
      hasInProgress: true,
      usedCurrentYearQuota: false,
      borrowedNextYearQuota: false,
      nextYearQuotaConsumed: false,
      reason: '已有進行中的 FA 宣告（待聯盟完成成功或拒絕後才能再次提出）'
    };
  }

  // 2. 檢查是否於去年（prevYear）已預支「今年（currentYear）」額度 -> 今年額度已用完，今年可提出 0 次（除非再預支明年額度，但每年總上限含預支為 1 次今年額度 + 1 次預支額度）
  const prevYearTxs = playerFaTxs.filter(tx => getTxYear_(tx) === prevYear);
  const borrowedCurrentYearFromPrevYear = prevYearTxs.some(tx => hasBorrowedNextYearQuota_(tx));

  // 3. 統計今年（currentYear）已提出紀錄與是否已預支明年額度
  const thisYearTxs = playerFaTxs.filter(tx => getTxYear_(tx) === currentYear);
  const currentYearCount = thisYearTxs.length;
  const borrowedNextYearInThisYear = thisYearTxs.some(tx => hasBorrowedNextYearQuota_(tx));

  // 情況 A：今年尚未提出 FA，且去年未預支今年額度 -> 可使用今年額度（1 次）
  if (currentYearCount === 0 && !borrowedCurrentYearFromPrevYear) {
    return {
      canApply: true,
      hasInProgress: false,
      usedCurrentYearQuota: false,
      borrowedNextYearQuota: false,
      nextYearQuotaConsumed: false,
      quotaMode: 'CURRENT_YEAR',
      reason: `${currentYear} 年度 FA 額度尚可使用（一年 1 次）`
    };
  }

  // 情況 B：今年尚未提出 FA，但去年已預支今年額度 -> 今年一般額度已用掉，但仍可預支明年（nextYear）額度於今年再提 1 次（提出後明年 nextYear 不能提 FA）
  if (currentYearCount === 0 && borrowedCurrentYearFromPrevYear) {
    return {
      canApply: true,
      hasInProgress: false,
      usedCurrentYearQuota: true,
      borrowedNextYearQuota: false,
      nextYearQuotaConsumed: false,
      quotaMode: 'BORROW_NEXT_YEAR',
      reason: `${currentYear} 年度額度已於去年預支，可預支 ${nextYear} 年度額度於今年再提 1 次（提出後 ${nextYear} 年不能提 FA）`
    };
  }

  // 情況 C：今年已提出 1 次且尚未預支明年額度 -> 可使用今年/明年額度於今年再提第 2 次（若本次預支明年額度，明年 nextYear 不能提 FA）
  if (currentYearCount === 1 && !borrowedNextYearInThisYear) {
    return {
      canApply: true,
      hasInProgress: false,
      usedCurrentYearQuota: true,
      borrowedNextYearQuota: false,
      nextYearQuotaConsumed: false,
      quotaMode: 'BORROW_NEXT_YEAR',
      reason: `${currentYear} 年度已提出 1 次，可預支 ${nextYear} 年度額度於今年再提 1 次（提出後 ${nextYear} 年不能提 FA）`
    };
  }

  // 情況 D：今年已提出 >= 2 次，或今年已預支明年額度 -> 今年額度已用罄，且明年額度已被使用
  const reasonText = borrowedNextYearInThisYear
    ? `${currentYear} 年度額度及 ${nextYear} 年度預支額度皆已使用（${nextYear} 年不能再提 FA）`
    : `${currentYear} 年度 FA 額度已達上限`;

  return {
    canApply: false,
    hasInProgress: false,
    usedCurrentYearQuota: true,
    borrowedNextYearQuota: borrowedNextYearInThisYear,
    nextYearQuotaConsumed: borrowedNextYearInThisYear,
    quotaMode: 'EXHAUSTED',
    reason: reasonText
  };
}

function syncFaApplyButtonsState_() {
  const isSuper = Boolean(currentUser && currentUser.role === 'super_admin');
  const isPlayerSelf = Boolean(currentUser && currentUser.role === 'player');
  const selfUserId = String(currentUser?.user_id || '').trim();
  const winStatus = checkFaWindowStatus_();

  let elig = {
    canApply: true,
    hasInProgress: false,
    quotaMode: 'CURRENT_YEAR',
    reason: ''
  };

  if (!isSuper && selfUserId) {
    elig = getPlayerFaEligibility_(selfUserId);
  }

  const shouldAllow = isSuper || (isPlayerSelf && winStatus.isOpen && elig.canApply);
  const disabledMsg = !winStatus.isOpen
    ? `目前不在 FA 申請期間（${winStatus.reason}）`
    : (elig.reason || '目前無法提出 FA 宣告');

  const applyButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
    const onClickAttr = String(btn.getAttribute('onclick') || '');
    const txt = String(btn.textContent || '');
    return onClickAttr.includes('openFaApplyModal') || txt.includes('宣告 FA');
  });

  applyButtons.forEach(btn => {
    if (btn.dataset.origLabel) {
      btn.innerHTML = btn.dataset.origLabel;
    }

    if (!shouldAllow) {
      btn.setAttribute('disabled', 'disabled');
      btn.disabled = true;
      btn.classList.add('opacity-50', 'cursor-not-allowed');
      if (btn.closest('#faWorkflowGuideBanner')) {
        btn.classList.add('pointer-events-none');
      }
      btn.title = disabledMsg;
    } else {
      btn.removeAttribute('disabled');
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
      btn.title = elig.quotaMode === 'BORROW_NEXT_YEAR'
        ? elig.reason
        : '宣告 FA 資格';
    }
  });

  const modalSubmitBtn = document.querySelector('#faApplyModal button[onclick*="submitFaApply"]');
  if (modalSubmitBtn) {
    if (!shouldAllow) {
      modalSubmitBtn.setAttribute('disabled', 'disabled');
      modalSubmitBtn.disabled = true;
      modalSubmitBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      modalSubmitBtn.removeAttribute('disabled');
      modalSubmitBtn.disabled = false;
      modalSubmitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
}

function renderFaGuideBanner_(isSuperAdmin) {
  const tbody = document.getElementById('transactionsTableBody');
  const tableEl = tbody ? tbody.closest('table') : null;
  const hostParent = tableEl ? tableEl.parentElement : null;
  if (!hostParent) return;

  let guideEl = document.getElementById('faWorkflowGuideBanner');
  if (!guideEl) {
    guideEl = document.createElement('div');
    guideEl.id = 'faWorkflowGuideBanner';
    guideEl.className = 'mb-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs';
    hostParent.insertBefore(guideEl, tableEl);
  }

  guideEl.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="font-black text-slate-800 flex items-center gap-1.5 whitespace-nowrap">
        <span class="w-2 h-2 rounded-full bg-purple-600 shrink-0"></span>
        <span>FA 宣告程序說明（球員提出・通知原隊・聯盟審核）</span>
      </div>
      <span class="text-[11px] font-bold text-slate-500 whitespace-nowrap">
        ${isSuperAdmin ? '總管理員模式：可於下方進行聯盟資格審核' : '球隊／球員檢視模式：球隊僅顯示提出名單，審核由聯盟統一辦理'}
      </span>
    </div>
    <div class="space-y-1.5 text-[11px] leading-relaxed text-slate-600">
      <div class="flex flex-wrap items-center gap-1">
        <span class="px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-black whitespace-nowrap">已確定FA隊伍</span>
        <span>知會原球隊 → 自行接洽新球隊 →</span>
        <button type="button" onclick="openFaApplyModal()" class="underline font-black text-emerald-700 hover:text-emerald-800 whitespace-nowrap">宣告 FA 資格</button>
        <span>→ 等待聯盟審核 → 申請成功</span>
      </div>
      <div class="flex flex-wrap items-center gap-1">
        <span class="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-black whitespace-nowrap">聯盟配對方式</span>
        <span>知會原球隊 →</span>
        <button type="button" onclick="openFaApplyModal()" class="underline font-black text-emerald-700 hover:text-emerald-800 whitespace-nowrap">宣告 FA 資格</button>
        <span>→ 等待聯盟通知 → 待球員選擇隊伍 → 申請成功</span>
      </div>
    </div>
  `;
}

function renderTransactions() {
  const tbody = document.getElementById('transactionsTableBody');
  if (!tbody) return;

  const allTxs = globalData.transactions || [];
  const currentTeam = (globalData.teams || []).find(
    t => String(t.team_id) === String(currentSelectedTeamId)
  );
  const isSuper = Boolean(currentUser && currentUser.role === 'super_admin');

  renderFaGuideBanner_(isSuper);

  // 非聯盟總管理員時，僅球員本人可提出 FA（球隊端僅顯示提出名單與狀態，不提供球隊自行審核）
  const btnFaApply = document.querySelector('button[onclick="openFaApplyModal()"]');
  if (btnFaApply) {
    const isPlayerSelf = Boolean(currentUser && currentUser.role === 'player');
    btnFaApply.classList.toggle('hidden', !isSuper && !isPlayerSelf);
  }

  // 1. 本隊提出／相關 FA 名單（球隊頁面僅顯示有誰提出與審核狀態，非聯盟管理員不顯示核准/駁回操作）
  const myTeamFaList = allTxs.filter(
    tx => isFaRecord_(tx) && isMyTeamTx_(tx, currentTeam)
  );

  // 2. 他隊已審核通過 FA
  const otherApprovedFaList = allTxs.filter(
    tx => isFaRecord_(tx) && !isMyTeamTx_(tx, currentTeam) && isApprovedStatus_(tx.admin_status)
  );

  const renderRow = (tx, tagText, tagClass, allowLeagueReview) => {
    const statusText = tx.admin_status || 'pending';
    const approved = isApprovedStatus_(statusText);
    const pending = isPendingStatus_(statusText);
    const statusClass = approved
      ? 'bg-emerald-100 text-emerald-800'
      : (pending ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800');

    // 僅聯盟總管理員（super_admin）可進行 FA 審核
    const reviewActionsHtml = (allowLeagueReview && pending && tx.tx_id)
      ? `
        <div class="mt-1.5 flex items-center justify-end gap-1">
          <button onclick="openFaReviewModal('${String(tx.tx_id).replace(/'/g, "\'")}', 'approved')" class="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black whitespace-nowrap">聯盟核准</button>
          <button onclick="openFaReviewModal('${String(tx.tx_id).replace(/'/g, "\'")}', 'rejected')" class="px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-black whitespace-nowrap">聯盟駁回</button>
        </div>
      `
      : '';

    const modeBadge = String(tx.note || '').includes('配對')
      ? `<span class="ml-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold whitespace-nowrap">聯盟配對</span>`
      : '';

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 text-slate-500 whitespace-nowrap">${tx.tx_date || '—'}</td>
        <td class="p-3 whitespace-nowrap">
          <span class="bg-purple-100 text-purple-800 font-black px-2 py-0.5 rounded">${tx.tx_type || 'FA'}</span>
          <span class="ml-1.5 ${tagClass} text-[10px] font-bold px-1.5 py-0.5 rounded">${tagText}</span>
          ${modeBadge}
        </td>
        <td class="p-3 whitespace-nowrap">
          <button type="button" onclick="openPlayerCard('${String(tx.user_id || '').replace(/'/g, "\'")}') " class="font-black text-bbt-navy hover:text-emerald-600 underline decoration-emerald-400 decoration-2 underline-offset-4 flex items-center gap-1 whitespace-nowrap">
            <span>${formatTxPlayerName_(tx)}</span>
            <i data-lucide="id-card" class="w-3.5 h-3.5 text-emerald-600 shrink-0"></i>
          </button>
        </td>
        <td class="p-3 text-slate-700">${tx.note || '—'}</td>
        <td class="p-3 text-right whitespace-nowrap">
          <span class="${statusClass} font-bold px-2 py-0.5 rounded-full text-[11px]">${statusText}</span>
          ${reviewActionsHtml}
        </td>
      </tr>
    `;
  };

  let html = '';

  html += `
    <tr class="bg-emerald-50/70">
      <td colspan="5" class="px-3 py-2 text-[11px] font-black text-emerald-800 whitespace-nowrap">
        本隊提出 FA 名單（${myTeamFaList.length}）${isSuper ? '・聯盟審核區' : '・僅顯示提出與通知紀錄'}
      </td>
    </tr>
  `;
  if (myTeamFaList.length > 0) {
    html += myTeamFaList.map(tx =>
      renderRow(tx, '已提出 · 通知原隊', 'bg-emerald-50 text-emerald-700 border border-emerald-200', isSuper)
    ).join('');
  } else {
    html += `<tr><td colspan="5" class="p-3 text-center text-xs text-slate-400">本隊目前尚無球員提出 FA</td></tr>`;
  }

  html += `
    <tr class="bg-slate-100/80">
      <td colspan="5" class="px-3 py-2 text-[11px] font-black text-slate-700 whitespace-nowrap">
        他隊已審核通過 FA（${otherApprovedFaList.length}）
      </td>
    </tr>
  `;
  if (otherApprovedFaList.length > 0) {
    html += otherApprovedFaList.map(tx =>
      renderRow(tx, '他隊 · 已核准', 'bg-slate-100 text-slate-600', false)
    ).join('');
  } else {
    html += `<tr><td colspan="5" class="p-3 text-center text-xs text-slate-400">目前尚無他隊已審核通過的 FA 紀錄</td></tr>`;
  }

  tbody.innerHTML = html;
  syncFaApplyButtonsState_();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openTeamProfileModal() {
  if (!currentSelectedTeamId) { alert('請先選擇球隊'); return; }
  document.getElementById('teamProfileModal').classList.remove('hidden');
  document.getElementById('teamProfileModal').classList.add('flex');
}
function closeTeamProfileModal() { document.getElementById('teamProfileModal').classList.add('hidden'); document.getElementById('teamProfileModal').classList.remove('flex'); }

async function openAttendanceModal() {
  if (!currentSelectedTeamId) { alert('請先選擇球隊'); return; }
  document.getElementById('attEditRecordId').value = '';
  document.getElementById('attendanceModalTitle').innerText = "賽前出勤回報與請假系統";
  document.getElementById('attendanceModal').classList.remove('hidden');
  document.getElementById('attendanceModal').classList.add('flex');
  await loadRemoteScheduleOptions();
}
function closeAttendanceModal() { document.getElementById('attendanceModal').classList.add('hidden'); document.getElementById('attendanceModal').classList.remove('flex'); }

function openAnnouncementModal() {
  if (!currentSelectedTeamId) { alert('請先選擇球隊'); return; }
  document.getElementById('announcementModal').classList.remove('hidden');
  document.getElementById('announcementModal').classList.add('flex');
}
function closeAnnouncementModal() { document.getElementById('announcementModal').classList.add('hidden'); document.getElementById('announcementModal').classList.remove('flex'); }

function clearFaNoteDefault_() {
  const noteEl = document.getElementById('faNote');
  if (!noteEl) return;
  noteEl.value = '';
  if (noteEl.tagName === 'TEXTAREA' || noteEl.tagName === 'INPUT') {
    noteEl.placeholder = '若選擇「已確定球隊」，請於此填寫球隊名稱';
  }
}

function ensureFaModeSelector_() {
  const modal = document.getElementById('faApplyModal');
  if (!modal) return;

  const noteInput = document.getElementById('faNote');
  const host = noteInput ? noteInput.parentElement : null;

  if (!document.getElementById('faFlowModeSelect') && host && host.parentElement) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-3';
    wrap.innerHTML = `
      <label class="block text-xs font-bold text-slate-700 mb-1">FA 申請途徑（由球員提出並知會原球隊）</label>
      <select id="faFlowModeSelect" class="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 bg-white">
        <option value="已確定球隊(下方備註請填寫球隊名稱)">已確定球隊(下方備註請填寫球隊名稱)</option>
        <option value="由聯盟配對">由聯盟配對</option>
      </select>
    `;
    host.parentElement.insertBefore(wrap, host);
  } else {
    const modeSel = document.getElementById('faFlowModeSelect');
    if (modeSel && modeSel.options.length > 0) {
      modeSel.options[0].value = '已確定球隊(下方備註請填寫球隊名稱)';
      modeSel.options[0].text = '已確定球隊(下方備註請填寫球隊名稱)';
      if (modeSel.options[1]) {
        modeSel.options[1].value = '由聯盟配對';
        modeSel.options[1].text = '由聯盟配對';
      }
    }
  }

  clearFaNoteDefault_();
}

function openFaApplyModal() {
  const isSuper = Boolean(currentUser && currentUser.role === 'super_admin');
  const selfUserId = String(currentUser?.user_id || '').trim();
  const winStatus = checkFaWindowStatus_();
  if (!isSuper && !winStatus.isOpen) {
    alert(`目前不在年度 FA 申請期間內（${winStatus.reason}），無法提出 FA 宣告。`);
    return;
  }
  if (!isSuper && selfUserId) {
    const elig = getPlayerFaEligibility_(selfUserId);
    if (!elig.canApply) {
      alert(`目前無法提出 FA 宣告：${elig.reason}`);
      syncFaApplyButtonsState_();
      return;
    }
  }
  ensureFaModeSelector_();
  updateTeamPlayerSelects();
  clearFaNoteDefault_();
  syncFaApplyButtonsState_();
  document.getElementById('faApplyModal').classList.remove('hidden');
  document.getElementById('faApplyModal').classList.add('flex');
  setTimeout(() => {
    updateTeamPlayerSelects();
    clearFaNoteDefault_();
    syncFaApplyButtonsState_();
  }, 0);
}
function closeFaApplyModal() { document.getElementById('faApplyModal').classList.add('hidden'); document.getElementById('faApplyModal').classList.remove('flex'); }

async function saveCurrentTeamProfile() {
  const intro = document.getElementById('editTeamIntro').value;
  const contact = document.getElementById('editTeamContact').value;
  const phone = document.getElementById('editTeamPhone').value;

  const res = await BBTApi.saveTeamProfile({ team_id: currentSelectedTeamId, intro, contact_name: contact, contact_phone: phone });
  if (res && res.result === 'ok') {
    alert('✅ 球隊資料已成功同步至 Google Sheets！');
    closeTeamProfileModal();
    initSystem();
  } else {
    alert('❌ 儲存失敗: ' + (res && res.message ? res.message : ''));
  }
}

async function submitAnnouncement() {
  const category = document.getElementById('annCategory').value;
  const title = document.getElementById('annTitle').value;
  const content = document.getElementById('annContent').value;
  const scopeSelect = document.getElementById('annScopeSelect');
  const scopeVal = scopeSelect ? scopeSelect.value : 'team';

  if (!title || !content) { alert('請填寫標題與內容'); return; }

  const payload = scopeVal === 'league'
    ? { team_id: 'ALL', scope: 'league', category, title, content }
    : { team_id: currentSelectedTeamId, scope: 'team', category, title, content };

  const res = await BBTApi.saveAnnouncement(payload);
  if (res && res.result === 'ok') {
    alert('✅ 公告已成功發布！');
    closeAnnouncementModal();
    await initSystem();
    if (currentSelectedTeamId) {
      renderAnnouncements();
    }
  } else {
    alert('❌ 發布失敗: ' + (res && res.message ? res.message : ''));
  }
}

async function submitFaApply() {
  const isSuper = Boolean(currentUser && currentUser.role === 'super_admin');
  const user_id = (!isSuper && currentUser?.user_id)
    ? String(currentUser.user_id).trim()
    : document.getElementById('faUserSelect').value;
  const rawNote = document.getElementById('faNote').value.trim();
  const flowMode = document.getElementById('faFlowModeSelect')?.value || '已確定球隊';

  if (!user_id) { alert('請選擇球員'); return; }

  const elig = getPlayerFaEligibility_(user_id);
  if (!isSuper && !elig.canApply) {
    alert(`❌ 無法送出 FA 宣告：${elig.reason}`);
    syncFaApplyButtonsState_();
    return;
  }

  const isBorrowingNextYear = elig.quotaMode === 'BORROW_NEXT_YEAR';
  const nextYear = new Date().getFullYear() + 1;
  const quotaTag = isBorrowingNextYear ? `・預支明年額度(${nextYear}年不可再提FA)` : '';

  const combinedNote = rawNote
    ? `【${flowMode}・已通知原隊${quotaTag}】${rawNote}`
    : `【${flowMode}・已通知原隊${quotaTag}】球員自行提出 FA 宣告，待聯盟審核`;

  const res = await BBTApi.saveTransaction({
    tx_type: 'FA申請',
    user_id,
    from_team_id: currentSelectedTeamId,
    to_team_id: flowMode === '由聯盟配對' ? 'LEAGUE_MATCH' : 'FA_MARKET',
    used_next_year_quota: isBorrowingNextYear,
    note: combinedNote
  });
  if (res && res.result === 'ok') {
    alert(isBorrowingNextYear
      ? `✅ FA 宣告申請已送出（已使用 ${nextYear} 年度額度），待聯盟審核後將同步至 fa.php 市場！`
      : '✅ FA 宣告申請已送出，待聯盟審核後將同步至 fa.php 市場！');
    closeFaApplyModal();
    await initSystem();
    syncFaApplyButtonsState_();
  } else {
    alert('❌ 申請失敗: ' + (res && res.message ? res.message : ''));
  }
}

function switchDiv(divName) {
  if (currentUser && currentUser.role !== 'super_admin') return;
  currentDivision = divName;
  window.currentDivision = divName;
  syncDivisionButtonsUI();

  currentSelectedTeamId = '';
  window.currentSelectedTeamId = '';
  renderTeamSidebar(document.getElementById('teamSearchInput')?.value || '');
  showKpiOverview();
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.add('hidden'));
  document.getElementById('panel-' + tabId).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(btn => { btn.className = "tab-btn px-5 py-3.5 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 flex items-center space-x-1.5 whitespace-nowrap"; });
  document.getElementById('tab-' + tabId).className = "tab-btn px-5 py-3.5 text-xs font-black border-b-2 border-emerald-600 text-emerald-700 bg-white flex items-center space-x-1.5 whitespace-nowrap";
}

function filterRosterRole(role) {
  currentRosterFilter = role;
  ['all', 'player', 'coach', 'manager'].forEach(r => {
    const btn = document.getElementById('filter-role-' + r);
    if (btn) btn.className = r === role ? "px-3 py-1 rounded-lg text-xs font-black bg-slate-800 text-white whitespace-nowrap" : "px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap";
  });
  renderRosterTable();
}

function filterTeamSidebar(keyword) { renderTeamSidebar(keyword); }
function onSeasonChange(season) { currentSeason = season; initSystem(); }

// ============================================================================
// 球季清單管理、球隊加入球季設定與歷屆球季戰績模組
// ============================================================================

const DEFAULT_SEASONS_FALLBACK = [
  { season_id: '2026-S18', season_name: '2026 第 18 季', year: 2026, is_current: true, status: 'active' },
  { season_id: '2026-S17', season_name: '2026 第 17 季', year: 2026, is_current: false, status: 'archived' }
];

function getNormalizedSeasonsList_() {
  const raw = Array.isArray(globalData.seasons) && globalData.seasons.length > 0
    ? globalData.seasons
    : DEFAULT_SEASONS_FALLBACK;

  return raw.map(s => ({
    season_id: String(s.season_id || '').trim(),
    season_name: String(s.season_name || s.season_id || '').trim(),
    year: Number(s.year || String(s.season_id || '').slice(0, 4) || new Date().getFullYear()),
    is_current: s.is_current === true || String(s.is_current || '').toUpperCase() === 'TRUE' || String(s.is_current) === '1',
    status: String(s.status || 'active').trim()
  })).filter(s => s.season_id);
}

function getSeasonDisplayName_(seasonId) {
  const sid = String(seasonId || '').trim();
  if (!sid) return '—';
  const found = getNormalizedSeasonsList_().find(s => s.season_id === sid);
  return found ? `${found.season_name} (${found.season_id})` : sid;
}

function renderSeasonDropdowns_() {
  const seasons = getNormalizedSeasonsList_();
  const isSuper = Boolean(currentUser && currentUser.role === 'super_admin');

  // 1. 頂部球季管理按鈕權限顯示
  const btnSeasonMgr = document.getElementById('btnOpenSeasonManager');
  if (btnSeasonMgr) {
    btnSeasonMgr.classList.toggle('hidden', !isSuper);
    if (isSuper) btnSeasonMgr.classList.add('flex');
  }

  // 2. 頂部 Header 球季選單
  const seasonSelect = document.getElementById('seasonSelect');
  if (seasonSelect) {
    const prevVal = currentSeason || seasonSelect.value;
    seasonSelect.innerHTML = seasons.map(s => {
      const currentTag = s.is_current ? ' (現行賽季)' : '';
      return `<option value="${s.season_id}">${s.season_name}${currentTag}</option>`;
    }).join('');

    if (seasons.some(s => s.season_id === prevVal)) {
      seasonSelect.value = prevVal;
    } else {
      const curSeasonObj = seasons.find(s => s.is_current) || seasons[0];
      if (curSeasonObj) {
        currentSeason = curSeasonObj.season_id;
        seasonSelect.value = currentSeason;
      }
    }
  }

  // 3. 新增球隊 Modal 的「加入球季」選單
  const newTeamSeasonSel = document.getElementById('newTeamSeason');
  if (newTeamSeasonSel) {
    newTeamSeasonSel.innerHTML = seasons.map(s =>
      `<option value="${s.season_id}">${s.season_name} (${s.season_id})</option>`
    ).join('');
    if (seasons.some(s => s.season_id === currentSeason)) {
      newTeamSeasonSel.value = currentSeason;
    }
  }
}

// --- 聯盟球季管理 Modal（支援新增、修改名稱／年度／狀態與設為現行賽季） ---
let editingSeasonOriginalId_ = '';

function ensureSeasonManagerModal_() {
  if (document.getElementById('seasonManagerModal')) return;

  const modal = document.createElement('div');
  modal.id = 'seasonManagerModal';
  modal.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-slate-900/60 p-3';
  modal.innerHTML = `
    <div class="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
      <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
        <div class="font-black text-sm flex items-center gap-2 whitespace-nowrap">
          <i data-lucide="calendar-range" class="w-4 h-4 text-emerald-400"></i>
          <span>球季清單管理（新增／異動／現行賽季）</span>
        </div>
        <button type="button" onclick="closeSeasonManagerModal()" class="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 whitespace-nowrap">✕</button>
      </div>

      <div class="p-4 overflow-y-auto space-y-4 text-xs">
        <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span id="seasonFormModeTitle" class="font-black text-slate-900">新增球季</span>
            <button type="button" onclick="resetSeasonFormToCreate_()" class="text-[11px] font-bold text-emerald-700 hover:underline whitespace-nowrap">+ 清空為新增模式</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">球季代碼 (season_id)</label>
              <input id="newSeasonIdInput" type="text" placeholder="例如 2026-S19" class="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800">
            </div>
            <div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">顯示名稱</label>
              <input id="newSeasonNameInput" type="text" placeholder="例如 2026 第 19 季" class="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800">
            </div>
            <div>
              <label class="block text-[11px] font-bold text-slate-600 mb-1">所屬年度</label>
              <input id="newSeasonYearInput" type="number" class="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800">
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div class="flex flex-wrap items-center gap-4">
              <label class="flex items-center gap-1.5 cursor-pointer select-none">
                <input id="newSeasonIsCurrentInput" type="checkbox" class="w-4 h-4 rounded text-emerald-600 border-slate-300">
                <span class="font-bold text-slate-700">設為現行賽季</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer select-none">
                <input id="newSeasonCarryOverTeamsInput" type="checkbox" class="w-4 h-4 rounded text-emerald-600 border-slate-300">
                <span class="font-bold text-slate-700">帶入現有球隊名單</span>
              </label>
            </div>
            <button type="button" id="btnSubmitSeasonForm" onclick="submitNewSeason()" class="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs whitespace-nowrap">儲存球季</button>
          </div>
        </div>

        <div class="space-y-2">
          <div class="font-black text-slate-900">已建立球季清單（可點選「異動」修改或「設為現行賽季」）</div>
          <div id="seasonManagerListContainer" class="space-y-2"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function resetSeasonFormToCreate_() {
  editingSeasonOriginalId_ = '';
  const seasons = getNormalizedSeasonsList_();
  const nextNum = seasons.length + 17;
  const nextYear = new Date().getFullYear();

  const titleEl = document.getElementById('seasonFormModeTitle');
  const submitBtn = document.getElementById('btnSubmitSeasonForm');
  const idInput = document.getElementById('newSeasonIdInput');
  const nameInput = document.getElementById('newSeasonNameInput');
  const yearInput = document.getElementById('newSeasonYearInput');
  const curInput = document.getElementById('newSeasonIsCurrentInput');
  const carryInput = document.getElementById('newSeasonCarryOverTeamsInput');

  if (titleEl) titleEl.innerText = '新增球季';
  if (submitBtn) submitBtn.innerText = '儲存新增';
  if (idInput) {
    idInput.value = `${nextYear}-S${nextNum}`;
    idInput.disabled = false;
  }
  if (nameInput) nameInput.value = `${nextYear} 第 ${nextNum} 季`;
  if (yearInput) yearInput.value = nextYear;
  if (curInput) curInput.checked = false;
  if (carryInput) carryInput.checked = true;
}

function startEditSeason_(seasonId) {
  const s = getNormalizedSeasonsList_().find(item => item.season_id === String(seasonId));
  if (!s) return;
  ensureSeasonManagerModal_();
  editingSeasonOriginalId_ = s.season_id;

  const titleEl = document.getElementById('seasonFormModeTitle');
  const submitBtn = document.getElementById('btnSubmitSeasonForm');
  const idInput = document.getElementById('newSeasonIdInput');
  const nameInput = document.getElementById('newSeasonNameInput');
  const yearInput = document.getElementById('newSeasonYearInput');
  const curInput = document.getElementById('newSeasonIsCurrentInput');

  if (titleEl) titleEl.innerText = `異動球季：${s.season_id}`;
  if (submitBtn) submitBtn.innerText = '儲存異動';
  if (idInput) {
    idInput.value = s.season_id;
    idInput.disabled = true;
  }
  if (nameInput) nameInput.value = s.season_name;
  if (yearInput) yearInput.value = s.year || new Date().getFullYear();
  if (curInput) curInput.checked = Boolean(s.is_current);
}

function openSeasonManagerModal() {
  if (!currentUser || currentUser.role !== 'super_admin') {
    alert('僅聯盟總管理員可管理球季清單');
    return;
  }
  ensureSeasonManagerModal_();
  resetSeasonFormToCreate_();
  renderSeasonManagerList_();

  const modal = document.getElementById('seasonManagerModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeSeasonManagerModal() {
  editingSeasonOriginalId_ = '';
  const modal = document.getElementById('seasonManagerModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function renderSeasonManagerList_() {
  const container = document.getElementById('seasonManagerListContainer');
  if (!container) return;
  const seasons = getNormalizedSeasonsList_();

  container.innerHTML = seasons.map(s => `
    <div class="p-3 rounded-xl border ${s.is_current ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-white'} flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-black text-slate-900">${s.season_name}</span>
          <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold text-[10px]">${s.season_id}</span>
          ${s.is_current ? '<span class="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-black text-[10px]">現行賽季</span>' : ''}
        </div>
        <div class="text-[11px] text-slate-400 mt-0.5">年度：${s.year}</div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button type="button" onclick="startEditSeason_('${String(s.season_id).replace(/'/g, "\'")}')" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] whitespace-nowrap">
          異動
        </button>
        ${!s.is_current ? `
          <button type="button" onclick="setAsCurrentSeason('${String(s.season_id).replace(/'/g, "\'")}')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold text-[11px] whitespace-nowrap">
            設為現行賽季
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function submitNewSeason() {
  const isEditing = Boolean(editingSeasonOriginalId_);
  const seasonId = isEditing
    ? editingSeasonOriginalId_
    : document.getElementById('newSeasonIdInput').value.trim();
  const seasonName = document.getElementById('newSeasonNameInput').value.trim();
  const yearVal = Number(document.getElementById('newSeasonYearInput').value) || new Date().getFullYear();
  const isCurrent = Boolean(document.getElementById('newSeasonIsCurrentInput').checked);
  const carryOverTeams = isEditing ? false : Boolean(document.getElementById('newSeasonCarryOverTeamsInput')?.checked);

  if (!seasonId || !seasonName) {
    alert('請填寫球季代碼與球季顯示名稱');
    return;
  }

  let res = { result: 'ok' };
  if (typeof BBTApi !== 'undefined' && typeof BBTApi.saveSeason === 'function') {
    res = await BBTApi.saveSeason({
      season_id: seasonId,
      season_name: seasonName,
      year: yearVal,
      is_current: isCurrent,
      is_update: isEditing,
      carry_over_teams: carryOverTeams,
      from_season: currentSeason
    });
  }

  if (res && res.result === 'ok') {
    const existingList = getNormalizedSeasonsList_();
    const updatedList = existingList.map(item => ({
      ...item,
      is_current: isCurrent ? false : item.is_current
    }));
    const idx = updatedList.findIndex(item => item.season_id === seasonId);
    const nextItem = {
      season_id: seasonId,
      season_name: seasonName,
      year: yearVal,
      is_current: isCurrent,
      status: 'active'
    };
    if (idx >= 0) {
      updatedList[idx] = { ...updatedList[idx], ...nextItem };
    } else {
      updatedList.unshift(nextItem);
    }
    globalData.seasons = updatedList;
    if (isCurrent) {
      currentSeason = seasonId;
    }
    renderSeasonDropdowns_();
    renderSeasonManagerList_();
    resetSeasonFormToCreate_();
    alert(`✅ 球季「${seasonName} (${seasonId})」已${isEditing ? '異動' : '新增'}！`);
    if (typeof initSystem === 'function') {
      await initSystem();
    }
  } else {
    alert('❌ 儲存球季失敗：' + (res && res.message ? res.message : '未知錯誤'));
  }
}

async function setAsCurrentSeason(seasonId) {
  const target = getNormalizedSeasonsList_().find(s => s.season_id === seasonId);
  if (!target) return;
  const res = await BBTApi.saveSeason({
    season_id: target.season_id,
    season_name: target.season_name,
    year: target.year,
    is_current: true,
    carry_over_teams: false
  });
  if (res && res.result === 'ok') {
    currentSeason = target.season_id;
    await initSystem();
    renderSeasonManagerList_();
  }
}

// --- 球隊加入球季與各季組別歷史設定 Modal ---
function openTeamSeasonModal(presetSeason = '') {
  if (!currentSelectedTeamId) {
    alert('請先選擇球隊');
    return;
  }
  const team = (globalData.teams || []).find(t => String(t.team_id) === String(currentSelectedTeamId));
  if (!team) return;

  const seasons = getNormalizedSeasonsList_();
  const joinedSel = document.getElementById('assignTeamJoinedSeason');
  const targetSel = document.getElementById('assignTargetSeason');

  const optionsHtml = seasons.map(s =>
    `<option value="${s.season_id}">${s.season_name} (${s.season_id})</option>`
  ).join('');

  joinedSel.innerHTML = optionsHtml;
  targetSel.innerHTML = optionsHtml;

  const defaultJoined = String(team.joined_season || team.season || currentSeason).trim();
  joinedSel.value = seasons.some(s => s.season_id === defaultJoined) ? defaultJoined : currentSeason;

  const targetSeason = presetSeason || currentSeason;
  targetSel.value = seasons.some(s => s.season_id === targetSeason) ? targetSeason : currentSeason;

  document.getElementById('teamSeasonModalSub').innerText = `${team.team_name} (${team.team_id})`;
  onAssignTargetSeasonChange(targetSel.value);

  const modal = document.getElementById('teamSeasonModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeTeamSeasonModal() {
  const modal = document.getElementById('teamSeasonModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function onAssignTargetSeasonChange(seasonId) {
  const team = (globalData.teams || []).find(t => String(t.team_id) === String(currentSelectedTeamId));
  const histList = globalData.team_season_history || [];
  const matched = histList.find(
    h => String(h.team_id) === String(currentSelectedTeamId) && String(h.season) === String(seasonId)
  );

  document.getElementById('assignTargetDivision').value =
    (matched && matched.division) || (team && team.division) || '大聯盟';
  document.getElementById('assignSeasonWins').value = matched && matched.wins !== undefined ? matched.wins : '';
  document.getElementById('assignSeasonLosses').value = matched && matched.losses !== undefined ? matched.losses : '';
  document.getElementById('assignSeasonTies').value = matched && matched.ties !== undefined ? matched.ties : '';
  document.getElementById('assignSeasonRankNote').value = (matched && matched.rank_note) || '';
}

async function submitTeamSeasonAssignment() {
  if (!currentSelectedTeamId) return;
  const team = (globalData.teams || []).find(t => String(t.team_id) === String(currentSelectedTeamId));
  const joinedSeason = document.getElementById('assignTeamJoinedSeason').value;
  const targetSeason = document.getElementById('assignTargetSeason').value;
  const targetDivision = document.getElementById('assignTargetDivision').value;
  const wins = document.getElementById('assignSeasonWins').value;
  const losses = document.getElementById('assignSeasonLosses').value;
  const ties = document.getElementById('assignSeasonTies').value;
  const rankNote = document.getElementById('assignSeasonRankNote').value.trim();

  const res = await BBTApi.saveTeamSeasonAssignment({
    team_id: currentSelectedTeamId,
    team_name: team ? team.team_name : '',
    joined_season: joinedSeason,
    season: targetSeason,
    division: targetDivision,
    wins: wins === '' ? '' : Number(wins),
    losses: losses === '' ? '' : Number(losses),
    ties: ties === '' ? '' : Number(ties),
    rank_note: rankNote
  });

  if (res && res.result === 'ok') {
    alert(`✅ 已儲存 ${team ? team.team_name : ''} 的球季與組別歷史設定！`);
    closeTeamSeasonModal();
    await initSystem();
    selectTeam(currentSelectedTeamId);
  } else {
    alert('❌ 儲存失敗：' + (res && res.message ? res.message : '未知錯誤'));
  }
}

// --- 渲染「歷屆球季與戰績」分頁與球隊上方加入球季徽章 ---
function renderTeamSeasonHistoryTab() {
  if (!currentSelectedTeamId) return;
  const team = (globalData.teams || []).find(t => String(t.team_id) === String(currentSelectedTeamId));
  const isSuper = Boolean(currentUser && currentUser.role === 'super_admin');
  const isTeamAdmin = Boolean(
    currentUser && currentUser.role === 'team_admin' && String(currentUser.team_id) === String(currentSelectedTeamId)
  );
  const canEdit = isSuper || isTeamAdmin;

  // 更新球隊標頭「加入球季」徽章與設定按鈕
  const joinedBadge = document.getElementById('teamJoinedSeasonBadge');
  if (joinedBadge && team) {
    const jSeason = team.joined_season || team.season || '—';
    joinedBadge.innerText = `加入球季：${jSeason}`;
  }
  const btnHeaderAssign = document.getElementById('btnTeamSeasonAssign');
  const btnTabAdd = document.getElementById('btnAddTeamSeasonHistoryRow');
  if (btnHeaderAssign) btnHeaderAssign.classList.toggle('hidden', !canEdit);
  if (btnTabAdd) btnTabAdd.classList.toggle('hidden', !canEdit);

  const tbody = document.getElementById('teamSeasonHistoryTableBody');
  if (!tbody) return;

  const seasons = getNormalizedSeasonsList_();
  const rawHist = (globalData.team_season_history || []).filter(
    h => String(h.team_id) === String(currentSelectedTeamId)
  );

  // 若尚無歷史紀錄，至少顯示現行球季預設列
  const rows = rawHist.length > 0
    ? rawHist
    : (team ? [{
        season: team.season || currentSeason,
        team_name: team.team_name,
        division: team.division || '大聯盟',
        wins: '',
        losses: '',
        ties: '',
        rank_note: '現行登錄賽季'
      }] : []);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">尚無歷屆球季紀錄</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const sObj = seasons.find(s => s.season_id === String(r.season));
    const sLabel = sObj ? `${sObj.season_name} (${sObj.season_id})` : r.season;
    const isJoined = team && String(team.joined_season || '') === String(r.season);
    const hasRecord = r.wins !== '' && r.wins !== undefined && r.wins !== null;
    const wltText = hasRecord ? `${r.wins}W - ${r.losses || 0}L - ${r.ties || 0}T` : '—';

    // 計算該季登錄人數
    const seasonRosterCount = (globalData.roster || []).filter(p =>
      String(p.team_id) === String(currentSelectedTeamId) &&
      (!p.season || String(p.season) === String(r.season))
    ).length;

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-3 font-black text-slate-900 whitespace-nowrap">
          <span>${sLabel}</span>
          ${isJoined ? '<span class="ml-1.5 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-black">加入首季</span>' : ''}
        </td>
        <td class="p-3 font-bold text-slate-700 whitespace-nowrap">${r.team_name || (team ? team.team_name : '—')}</td>
        <td class="p-3 whitespace-nowrap">
          <span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-black text-[11px]">${r.division || '—'}</span>
        </td>
        <td class="p-3 font-bold text-slate-800 whitespace-nowrap">${wltText}</td>
        <td class="p-3 text-slate-600">${r.rank_note || '—'}</td>
        <td class="p-3 text-center font-black text-emerald-700 whitespace-nowrap">${seasonRosterCount} 人</td>
        <td class="p-3 text-right whitespace-nowrap">
          ${canEdit
            ? `<button type="button" onclick="openTeamSeasonModal('${String(r.season).replace(/'/g, "\\'")}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold px-2.5 py-1 rounded-lg transition">編輯</button>`
            : '<span class="text-slate-300 text-[10px]">—</span>'}
        </td>
      </tr>
    `;
  }).join('');
}
