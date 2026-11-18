// ============================================================================
// BBT 軟式棒球聯盟 - 全新站點 API 服務模組 (api.js)
// ============================================================================

// ⚠️ 請替換成您全新部署的 Google Apps Script 網頁應用程式網址
const API_BASE_URL = "https://script.google.com/macros/s/AKfycbzLsW1ccI4HVGy7kv1jLYhJeIhQ0q3Fp6dZaouIESTOJkkEW5pvj3ZKX7dXzej-6PNraQ/exec";

/**
 * 通用 API 請求包裝器 (支援 GET / POST)
 */
async function callApi(action, data = {}) {
  try {
    // 組合參數
    const payload = {
      action: action,
      ...data
    };

    // 發送 POST 請求至 GAS
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8', // 避免 GAS CORS 預檢問題
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

/**
 * 快捷方法集錦：對應後端所有核心動作
 */
const BBTApi = {
  // 1. 初始化載入全部資料 (球隊、名單、成績、公告、異動)
  async getInitData(season = '', teamId = '') {
    return await callApi('getTeamSystemInitData', { season, team_id: teamId });
  },

  // 2. 儲存球隊基本資料
  async saveTeamProfile(teamData) {
    return await callApi('saveTeamProfile', { data: JSON.stringify(teamData) });
  },

  // 3. 新增或更新球員/教練名單
  async saveRoster(rosterData) {
    return await callApi('saveTeamRoster', { data: JSON.stringify(rosterData) });
  },

  // 4. 移除球員名單
  async deleteRoster(rosterId) {
    return await callApi('deleteTeamRoster', { roster_id: rosterId });
  },

  // 5. 取得中職風格球員卡完整細節 (含本季與生涯加總)
  async getPlayerCard(userId, season = '2026-S18') {
    return await callApi('getPlayerCardDetail', { user_id: userId, season: season });
  },

  // 6. 儲存球員單季成績
  async savePlayerStats(statsData) {
    return await callApi('savePlayerStats', { data: JSON.stringify(statsData) });
  },

  // 7. 取得場次出賽與請假名單
  async getAttendance(gameId, teamId) {
    return await callApi('getTeamAttendanceByGame', { game_id: gameId, team_id: teamId });
  },

  // 8. 回報出席或請假
  async saveAttendance(attData) {
    return await callApi('saveTeamAttendance', { data: JSON.stringify(attData) });
  },

  // 9. 發布球隊公告
  async saveAnnouncement(annData) {
    return await callApi('saveTeamAnnouncement', { data: JSON.stringify(annData) });
  },

  // 10. 提出球員異動/FA 申請
  async saveTransaction(txData) {
    return await callApi('savePlayerTransaction', { data: JSON.stringify(txData) });
  },

  // 11. 管理員審核異動單 (自動連動更新名單)
  async approveTransaction(txId, status = 'approved') {
    return await callApi('approvePlayerTransaction', { tx_id: txId, admin_status: status });
  }
};
