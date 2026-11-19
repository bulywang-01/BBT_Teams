// ============================================================================
// BBT 軟式棒球聯盟 - 全新站點 API 服務模組 (api.js)
// 整合帳號登入、Session Token 夾帶、建帳與選帳登錄、個人資料、權限指派與 FA 審查
// ============================================================================

const API_BASE_URL = "https://script.google.com/macros/s/AKfycbyJjH3nGnvaP1rKqWtvmBzd0uNT0hn3S0Yursp081QedQLG_-Re3j3zrH9_zsfrM4S8Gw/exec";
const AUTH_SESSION_STORAGE_KEY = 'bbt_auth_session';

function getStoredAuthToken_() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return (parsed && parsed.token) ? String(parsed.token) : '';
  } catch (e) {
    return '';
  }
}

async function callApi(action, data = {}) {
  try {
    const token = getStoredAuthToken_();
    const payload = {
      action: action,
      ...(token ? { token: token } : {}),
      ...data
    };

    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`網路請求失敗，狀態碼: ${response.status}`);
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error(`API 呼叫錯誤 [${action}]:`, error);
    return { result: 'error', message: error.message };
  }
}

const BBTApi = {
  // --- Session 管理輔助 ---
  setSession(sessionObj) {
    if (!sessionObj) {
      localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(sessionObj));
  },

  getSession() {
    try {
      const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  clearSession() {
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  },

  // --- 帳號登入、登出、建帳、個人資料與權限 ---
  async login(account, password) {
    const res = await callApi('login', { account: account, password: password });
    if (res && res.result === 'ok' && res.token) {
      this.setSession({
        token: res.token,
        user: res.user
      });
    }
    return res;
  },

  async logout() {
    const res = await callApi('logout', {});
    this.clearSession();
    return res;
  },

  async createUserAccount(accountPayload) {
    return await callApi('createUserAccount', { data: JSON.stringify(accountPayload) });
  },

  async updateSelfProfile(profileData) {
    return await callApi('updateSelfProfile', { data: JSON.stringify(profileData) });
  },

  async assignUserRole(rolePayload) {
    return await callApi('assignUserRole', rolePayload);
  },

  // --- 球隊與賽事系統 ---
  async getInitData(season = '', teamId = '') {
    return await callApi('getTeamSystemInitData', { season, team_id: teamId });
  },

  async saveSeason(seasonData) {
    return await callApi('saveSeason', { data: JSON.stringify(seasonData) });
  },

  async saveTeamSeasonAssignment(assignData) {
    return await callApi('saveTeamSeasonAssignment', { data: JSON.stringify(assignData) });
  },

  async saveTeamProfile(teamData) {
    return await callApi('saveTeamProfile', { data: JSON.stringify(teamData) });
  },

  async saveRoster(rosterData) {
    return await callApi('saveTeamRoster', { data: JSON.stringify(rosterData) });
  },

  async deleteRoster(rosterId) {
    return await callApi('deleteTeamRoster', { roster_id: rosterId });
  },

  async getPlayerCard(userId, season = '2026-S18') {
    return await callApi('getPlayerCardDetail', { user_id: userId, season: season });
  },

  async savePlayerStats(statsData) {
    return await callApi('savePlayerStats', { data: JSON.stringify(statsData) });
  },

  async getAttendance(gameId, teamId) {
    return await callApi('getTeamAttendanceByGame', { game_id: gameId, team_id: teamId });
  },

  async saveAttendance(attData) {
    return await callApi('saveTeamAttendance', { data: JSON.stringify(attData) });
  },

  async saveAnnouncement(annData) {
    return await callApi('saveTeamAnnouncement', { data: JSON.stringify(annData) });
  },

  async saveTransaction(txData) {
    return await callApi('savePlayerTransaction', { data: JSON.stringify(txData) });
  },

  async approveTransaction(txId, status = 'approved', extra = {}) {
    return await callApi('approvePlayerTransaction', {
      tx_id: txId,
      admin_status: status,
      decision: status,
      ...extra
    });
  },

  async reviewFaTransaction(reviewPayload) {
    return await callApi('reviewFaTransaction', { data: JSON.stringify(reviewPayload) });
  },

  // 🌟 跨表遠端讀取共用賽事表
  async getRemoteSchedule(scheduleSheetId, sheetName = 'Games') {
    return await callApi('getRemoteSchedule', { schedule_sheet_id: scheduleSheetId, sheet_name: sheetName });
  }
};
