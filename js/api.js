// ============================================================================
// BBT 軟式棒球聯盟 - 全新站點 API 服務模組 (api.js)
// ============================================================================

const API_BASE_URL = "https://script.google.com/macros/s/AKfycbzuiDAxjUJxslGOa3r76qVL2MSF7757-3QiGKLrM8EXaXq6dYY-Gb9o1Esl9XfnKuUVTQ/exec";

async function callApi(action, data = {}) {
  try {
    const payload = {
      action: action,
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
  async getInitData(season = '', teamId = '') {
    return await callApi('getTeamSystemInitData', { season, team_id: teamId });
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

  async approveTransaction(txId, status = 'approved') {
    return await callApi('approvePlayerTransaction', { tx_id: txId, admin_status: status });
  },

  // 🌟 新增：跨表遠端讀取共用賽事表
  async getRemoteSchedule(scheduleSheetId, sheetName = 'Schedule') {
    return await callApi('getRemoteSchedule', { schedule_sheet_id: scheduleSheetId, sheet_name: sheetName });
  }
};
