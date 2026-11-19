// ============================================================================
// BBT 軟式棒球聯盟 - 帳號登入、角色權限控管與個人資料模組 (js/auth.js)
// 完整支援：super_admin / team_admin / player、個人資料維護、權限指派
// ============================================================================

const BBTAuth = {
  AUTH_STORAGE_KEY: 'bbt_current_user_session',
  ROLE_OVERRIDE_KEY: 'bbt_role_overrides',
  CUSTOM_PWD_KEY: 'bbt_custom_passwords',

  getCurrentUser() {
    if (window.currentUser) return window.currentUser;
    try {
      const saved = localStorage.getItem(this.AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        window.currentUser = parsed;
        return parsed;
      }
    } catch (e) {
      console.error('讀取登入 Session 失敗:', e);
    }
    return null;
  },

  restoreSession() {
    const user = this.getCurrentUser();
    if (user && typeof BBTApi !== 'undefined' && typeof BBTApi.getSession === 'function') {
      const apiSess = BBTApi.getSession();
      if (apiSess && apiSess.token && !user.token) {
        user.token = apiSess.token;
        window.currentUser = user;
      }
    }
    return user;
  },

  setSession(userObj, token = '') {
    const fullUser = {
      ...userObj,
      ...(token ? { token } : {})
    };
    window.currentUser = fullUser;
    localStorage.setItem(this.AUTH_STORAGE_KEY, JSON.stringify(fullUser));

    if (typeof BBTApi !== 'undefined' && typeof BBTApi.setSession === 'function') {
      BBTApi.setSession({
        token: token || fullUser.token || '',
        user: fullUser
      });
    }
  },

  async clearSession(callBackendLogout = true) {
    if (callBackendLogout && typeof BBTApi !== 'undefined' && typeof BBTApi.logout === 'function') {
      try {
        await BBTApi.logout();
      } catch (e) {
        console.warn('後端登出通知略過:', e);
      }
    }
    window.currentUser = null;
    localStorage.removeItem(this.AUTH_STORAGE_KEY);
    if (typeof BBTApi !== 'undefined' && typeof BBTApi.clearSession === 'function') {
      BBTApi.clearSession();
    }
  },

  /**
   * 將後端回傳的 user 物件標準化為前端使用的 { user_id, name, role, team_id, title, managed_team_ids, member_team_ids }
   */
  normalizeBackendUser(backendUser, rosterList = [], teamsList = []) {
    const uid = String(backendUser.user_id || '').trim();
    const matchedPlayer = rosterList.find(r => String(r.user_id).trim() === uid) || {};

    let role = 'player';
    if (String(backendUser.global_role || '').trim() === 'super_admin') {
      role = 'super_admin';
    } else {
      const teamRolesMap = backendUser.team_roles_map || {};
      const roleValues = Object.values(teamRolesMap);
      if (roleValues.includes('team_admin') || (backendUser.managed_team_ids && backendUser.managed_team_ids.length > 0)) {
        role = 'team_admin';
      } else {
        role = 'player';
      }
    }

    let primaryTeamId = '';
    if (role === 'team_admin') {
      primaryTeamId = (backendUser.managed_team_ids && backendUser.managed_team_ids[0])
        || (backendUser.member_team_ids && backendUser.member_team_ids[0])
        || matchedPlayer.team_id
        || '';
    } else if (role === 'player') {
      primaryTeamId = (backendUser.member_team_ids && backendUser.member_team_ids[0])
        || matchedPlayer.team_id
        || '';
    }

    const teamObj = teamsList.find(t => String(t.team_id) === String(primaryTeamId));
    const displayName = matchedPlayer.player_name
      || backendUser.name
      || (role === 'super_admin' ? '王韶文 (系統總管)' : (backendUser.account || uid));

    const roleTitleMap = {
      'super_admin': '聯盟最高總管理員',
      'team_admin': teamObj ? `${teamObj.team_name} 管理員` : '球隊管理員 (教練/領隊)',
      'player': `現役隊員${matchedPlayer.number ? ` (#${matchedPlayer.number})` : ''}`
    };

    return {
      user_id: uid,
      account: backendUser.account || uid,
      name: displayName,
      role: role,
      global_role: backendUser.global_role || 'user',
      team_id: primaryTeamId,
      team_roles_map: backendUser.team_roles_map || {},
      managed_team_ids: backendUser.managed_team_ids || [],
      member_team_ids: backendUser.member_team_ids || [],
      title: roleTitleMap[role] || '聯盟成員'
    };
  },

  openLoginModal() {
    const errBox = document.getElementById('loginErrorMsg');
    if (errBox) errBox.classList.add('hidden');
    const modal = document.getElementById('loginModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  },

  closeLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  },

  async handleAuthButtonClick() {
    const user = this.getCurrentUser();
    if (user) {
      if (confirm(`確定要登出目前帳號 (${user.name}) 嗎？`)) {
        await this.clearSession(true);
        location.reload();
      }
    } else {
      this.openLoginModal();
    }
  },

  async submitLogin(e) {
    e.preventDefault();
    const account = document.getElementById('loginAccountInput').value.trim();
    const password = document.getElementById('loginPasswordInput').value.trim();
    const errBox = document.getElementById('loginErrorMsg');
    const btn = document.getElementById('btnSubmitLogin');

    errBox.classList.add('hidden');
    btn.disabled = true;
    btn.innerText = '驗證中...';

    try {
      const rosterList = (window.globalData && window.globalData.roster) || [];
      const teamsList = (window.globalData && window.globalData.teams) || [];

      // 1. 優先呼叫後端 GAS BBTApi.login
      if (typeof BBTApi !== 'undefined' && typeof BBTApi.login === 'function') {
        const apiRes = await BBTApi.login(account, password);
        if (apiRes && apiRes.result === 'ok' && apiRes.user) {
          const normalized = this.normalizeBackendUser(apiRes.user, rosterList, teamsList);
          this.setSession(normalized, apiRes.token || '');
          this.closeLoginModal();
          if (typeof initSystem === 'function') {
            await initSystem();
          }
          return;
        }
        // 若後端明確回傳帳號密碼錯誤或停用，直接顯示後端訊息
        if (apiRes && apiRes.result === 'error' && apiRes.message && !apiRes.message.includes('找不到 Users')) {
          throw new Error(apiRes.message);
        }
      }

      // 2. 若後端 Users 表尚未建置或回傳找不到 Users，則使用本機名單比對備援
      const roleOverrides = JSON.parse(localStorage.getItem(this.ROLE_OVERRIDE_KEY) || '{}');
      const customPasswords = JSON.parse(localStorage.getItem(this.CUSTOM_PWD_KEY) || '{}');

      if (account.toLowerCase() === 'admin') {
        const expectedPwd = customPasswords['admin'] || '1234';
        if (password !== expectedPwd) throw new Error('總管理員密碼錯誤');
        this.setSession({
          user_id: 'ADMIN',
          account: 'admin',
          name: '王韶文 (系統總管)',
          role: 'super_admin',
          global_role: 'super_admin',
          team_id: '',
          title: '聯盟最高總管理員'
        });
      } else {
        const matchedPlayer = rosterList.find(r =>
          String(r.user_id).toLowerCase() === account.toLowerCase() ||
          String(r.player_name).trim() === account
        );

        if (!matchedPlayer) {
          throw new Error('找不到此帳號或球員代號，請確認輸入是否正確。');
        }

        const expectedPwd = customPasswords[matchedPlayer.user_id] || matchedPlayer.password || '1234';
        if (password !== expectedPwd) {
          throw new Error('登入密碼錯誤（預設密碼為 1234）');
        }

        let assignedRole = roleOverrides[matchedPlayer.user_id] || matchedPlayer.system_role || '';
        if (!assignedRole) {
          const rType = String(matchedPlayer.role_type || '').toLowerCase();
          if (rType.includes('coach') || rType.includes('leader') || rType.includes('教練') || rType.includes('領隊') || rType.includes('隊長')) {
            assignedRole = 'team_admin';
          } else {
            assignedRole = 'player';
          }
        }

        const roleTitleMap = {
          'super_admin': '聯盟最高總管理員',
          'team_admin': '球隊管理員 (教練/領隊)',
          'player': `現役隊員${matchedPlayer.number ? ` (#${matchedPlayer.number})` : ''}`
        };

        this.setSession({
          user_id: matchedPlayer.user_id,
          account: matchedPlayer.user_id,
          name: matchedPlayer.player_name,
          role: assignedRole,
          global_role: assignedRole === 'super_admin' ? 'super_admin' : 'user',
          team_id: matchedPlayer.team_id,
          title: roleTitleMap[assignedRole] || '聯盟成員'
        });
      }

      this.closeLoginModal();
      this.applyRolePermissions();
      if (typeof loadRemoteScheduleOptions === 'function') await loadRemoteScheduleOptions();
      if (typeof renderAnnouncements === 'function') renderAnnouncements();
      if (typeof renderTransactions === 'function') renderTransactions();
    } catch (err) {
      errBox.innerText = err.message || '登入失敗，請稍後再試';
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerText = '登入系統';
    }
  },

  applyRolePermissions() {
    const user = this.getCurrentUser();
    if (!user) return;

    const role = user.role;
    document.getElementById('userNameDisplay').innerText = user.name;
    document.getElementById('userTitleDisplay').innerText = user.title;

    const btnAuth = document.getElementById('btnAuthAction');
    btnAuth.className = "bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-xl transition border border-slate-700 flex items-center space-x-1";
    document.getElementById('btnAuthText').innerText = "登出";

    const rosterList = (window.globalData && window.globalData.roster) || [];
    const teamsList = (window.globalData && window.globalData.teams) || [];
    const hasRosterProfile = rosterList.some(r => String(r.user_id) === String(user.user_id));

    const btnSelf = document.getElementById('btnOpenSelfProfile');
    if (hasRosterProfile) {
      btnSelf.classList.remove('hidden');
      btnSelf.classList.add('flex');
    } else {
      btnSelf.classList.add('hidden');
      btnSelf.classList.remove('flex');
    }

    const btnRoleMgr = document.getElementById('btnOpenAdminRoleMgr');
    if (role === 'super_admin') {
      btnRoleMgr.classList.remove('hidden');
      btnRoleMgr.classList.add('flex');
    } else {
      btnRoleMgr.classList.add('hidden');
      btnRoleMgr.classList.remove('flex');
    }

    const leftSidebar = document.getElementById('leftTeamSidebar');
    const rightWorkspace = document.getElementById('rightMainWorkspace');
    const divisionGroup = document.getElementById('divisionFilterGroup');

    if (role === 'super_admin') {
      document.getElementById('roleBadge').innerText = "SUPER ADMIN";
      document.getElementById('roleBadge').className = "bg-emerald-500/20 text-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-widest";

      leftSidebar.classList.remove('hidden');
      rightWorkspace.className = "lg:col-span-8 space-y-5";
      divisionGroup.classList.remove('hidden');

      this.toggleManagementControls(true);

      if (typeof renderTeamSidebar === 'function') renderTeamSidebar();
      const filteredTeams = teamsList.filter(t => String(t.division).trim() === window.currentDivision);
      if (filteredTeams.length > 0 && !window.currentSelectedTeamId) {
        if (typeof selectTeam === 'function') selectTeam(filteredTeams[0].team_id);
      } else if (window.currentSelectedTeamId) {
        if (typeof selectTeam === 'function') selectTeam(window.currentSelectedTeamId);
      } else if (teamsList.length > 0) {
        if (typeof selectTeam === 'function') selectTeam(teamsList[0].team_id);
      }
    } else {
      leftSidebar.classList.add('hidden');
      rightWorkspace.className = "lg:col-span-12 space-y-5";
      divisionGroup.classList.add('hidden');

      const myTeam = teamsList.find(t => String(t.team_id) === String(user.team_id));
      if (myTeam) {
        window.currentDivision = String(myTeam.division).trim() || window.currentDivision;
        if (typeof selectTeam === 'function') selectTeam(myTeam.team_id);
      }

      if (role === 'team_admin') {
        document.getElementById('roleBadge').innerText = "TEAM ADMIN";
        document.getElementById('roleBadge').className = "bg-amber-500/20 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-500/30 uppercase tracking-widest";
        this.toggleManagementControls(true);
      } else {
        document.getElementById('roleBadge').innerText = "PLAYER";
        document.getElementById('roleBadge').className = "bg-sky-500/20 text-sky-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-sky-500/30 uppercase tracking-widest";
        this.toggleManagementControls(false);
      }
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  toggleManagementControls(canManageTeam) {
    const btnTeamEdit = document.getElementById('btnTeamProfileEdit');
    const btnBatchAtt = document.getElementById('btnBatchAttendance');
    const btnNewAnn = document.getElementById('btnNewAnnouncement');
    const singleAttText = document.getElementById('btnSingleAttendanceText');
    const attHeader = document.getElementById('attendanceHeaderTitle');

    if (canManageTeam) {
      btnTeamEdit.classList.remove('hidden');
      btnBatchAtt.classList.remove('hidden');
      btnNewAnn.classList.remove('hidden');
      singleAttText.innerText = '+ 單筆回報';
      attHeader.innerText = '球員出席回報與請假管理控制台';
    } else {
      btnTeamEdit.classList.add('hidden');
      btnBatchAtt.classList.add('hidden');
      btnNewAnn.classList.add('hidden');
      singleAttText.innerText = '+ 我要出席回報 / 請假';
      attHeader.innerText = '我的賽前出勤回報與球隊出賽狀態';
    }
  },

  openSelfProfileModal() {
    const user = this.getCurrentUser();
    if (!user) return;
    const rosterList = (window.globalData && window.globalData.roster) || [];
    const pObj = rosterList.find(r => String(r.user_id) === String(user.user_id));
    if (!pObj) {
      alert('此管理員帳號未綁定球員名單資料');
      return;
    }

    document.getElementById('selfName').value = pObj.player_name || '';
    document.getElementById('selfNumber').value = pObj.number ? `#${pObj.number}` : '未設定';
    document.getElementById('selfPosition').value = pObj.position || '';
    document.getElementById('selfBatThrow').value = pObj.bat_throw || '右投右打';
    document.getElementById('selfPhone').value = pObj.phone || '';
    document.getElementById('selfNewPassword').value = '';

    document.getElementById('selfProfileModal').classList.remove('hidden');
    document.getElementById('selfProfileModal').classList.add('flex');
  },

  closeSelfProfileModal() {
    document.getElementById('selfProfileModal').classList.add('hidden');
    document.getElementById('selfProfileModal').classList.remove('flex');
  },

  async saveSelfProfile() {
    const user = this.getCurrentUser();
    if (!user) return;
    const rosterList = (window.globalData && window.globalData.roster) || [];
    const pObj = rosterList.find(r => String(r.user_id) === String(user.user_id));

    const position = document.getElementById('selfPosition').value.trim();
    const bat_throw = document.getElementById('selfBatThrow').value;
    const phone = document.getElementById('selfPhone').value.trim();
    const newPwd = document.getElementById('selfNewPassword').value.trim();

    if (pObj) {
      pObj.position = position;
      pObj.bat_throw = bat_throw;
      pObj.phone = phone;
    }

    if (newPwd) {
      const customPasswords = JSON.parse(localStorage.getItem(this.CUSTOM_PWD_KEY) || '{}');
      customPasswords[user.user_id] = newPwd;
      localStorage.setItem(this.CUSTOM_PWD_KEY, JSON.stringify(customPasswords));
    }

    if (typeof BBTApi !== 'undefined' && typeof BBTApi.updateSelfProfile === 'function') {
      const res = await BBTApi.updateSelfProfile({
        user_id: user.user_id,
        team_id: user.team_id,
        position,
        bat_throw,
        phone,
        ...(newPwd ? { new_password: newPwd } : {})
      });
      if (res && res.result === 'error') {
        alert('❌ 更新失敗: ' + (res.message || ''));
        return;
      }
    }

    alert('✅ 個人資料已更新！');
    this.closeSelfProfileModal();
    if (typeof renderRosterTable === 'function') renderRosterTable();
  },

  openAdminRoleModal() {
    const teamsList = (window.globalData && window.globalData.teams) || [];
    const teamSel = document.getElementById('roleMgrTeamSelect');
    teamSel.innerHTML = teamsList.map(t => `<option value="${t.team_id}">${t.team_name} (${t.division})</option>`).join('');
    if (window.currentSelectedTeamId) teamSel.value = window.currentSelectedTeamId;
    this.populateRoleMgrPlayerSelect();

    document.getElementById('adminRoleModal').classList.remove('hidden');
    document.getElementById('adminRoleModal').classList.add('flex');
  },

  closeAdminRoleModal() {
    document.getElementById('adminRoleModal').classList.add('hidden');
    document.getElementById('adminRoleModal').classList.remove('flex');
  },

  populateRoleMgrPlayerSelect() {
    const teamId = document.getElementById('roleMgrTeamSelect').value;
    const userSel = document.getElementById('roleMgrUserSelect');
    const rosterList = (window.globalData && window.globalData.roster) || [];
    const members = rosterList.filter(r => String(r.team_id) === String(teamId));
    const roleOverrides = JSON.parse(localStorage.getItem(this.ROLE_OVERRIDE_KEY) || '{}');

    userSel.innerHTML = members.length > 0
      ? members.map(m => {
          const curRole = roleOverrides[m.user_id] || '預設';
          return `<option value="${m.user_id}">#${m.number || '—'} ${m.player_name} [${m.role_type || 'player'}] (目前權限: ${curRole})</option>`;
        }).join('')
      : `<option value="">該球隊尚無登錄人員</option>`;
  },

  async saveAssignedUserRole() {
    const userId = document.getElementById('roleMgrUserSelect').value;
    const teamId = document.getElementById('roleMgrTeamSelect').value;
    const newRole = document.getElementById('roleMgrLevelSelect').value;
    if (!userId) return;

    const roleOverrides = JSON.parse(localStorage.getItem(this.ROLE_OVERRIDE_KEY) || '{}');
    roleOverrides[userId] = newRole;
    localStorage.setItem(this.ROLE_OVERRIDE_KEY, JSON.stringify(roleOverrides));

    if (typeof BBTApi !== 'undefined' && typeof BBTApi.assignUserRole === 'function') {
      const res = await BBTApi.assignUserRole({
        user_id: userId,
        team_id: teamId,
        role_level: newRole
      });
      if (res && res.result === 'error') {
        alert('❌ 後端權限指派失敗: ' + (res.message || ''));
        return;
      }
    }

    alert('✅ 已成功指派該帳號權限！下次該帳號登入時將套用新權限。');
    this.populateRoleMgrPlayerSelect();
  }
};

// 全域相容包裝，供 HTML 事件直接呼叫
function submitLogin(e) { return BBTAuth.submitLogin(e); }
function handleAuthButtonClick() { return BBTAuth.handleAuthButtonClick(); }
function openSelfProfileModal() { return BBTAuth.openSelfProfileModal(); }
function closeSelfProfileModal() { return BBTAuth.closeSelfProfileModal(); }
function saveSelfProfile() { return BBTAuth.saveSelfProfile(); }
function openAdminRoleModal() { return BBTAuth.openAdminRoleModal(); }
function closeAdminRoleModal() { return BBTAuth.closeAdminRoleModal(); }
function populateRoleMgrPlayerSelect() { return BBTAuth.populateRoleMgrPlayerSelect(); }
function saveAssignedUserRole() { return BBTAuth.saveAssignedUserRole(); }
