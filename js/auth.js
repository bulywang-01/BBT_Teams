// ============================================================================
// BBT 軟式棒球聯盟 - 帳號登入、角色權限控管與個人資料模組 (js/auth.js)
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
    window.currentSelectedTeamId = '';
    localStorage.removeItem(this.AUTH_STORAGE_KEY);
    if (typeof BBTApi !== 'undefined' && typeof BBTApi.clearSession === 'function') {
      BBTApi.clearSession();
    }
  },

  _resolveDisplayName(uid, backendUser = {}, usersList = [], rosterList = []) {
    const targetId = String(uid || '').trim().toLowerCase();
    const targetAcc = String(backendUser.account || '').trim().toLowerCase();

    const matchedUserRow = usersList.find(u =>
      (targetId && String(u.user_id || '').trim().toLowerCase() === targetId) ||
      (targetAcc && String(u.account || '').trim().toLowerCase() === targetAcc)
    ) || {};

    const matchedPlayer = rosterList.find(r =>
      (targetId && String(r.user_id || '').trim().toLowerCase() === targetId) ||
      (targetAcc && String(r.account || '').trim().toLowerCase() === targetAcc)
    ) || {};

    return String(
      matchedUserRow.player_name
      || matchedUserRow.name
      || backendUser.player_name
      || backendUser.name
      || backendUser.full_name
      || backendUser.user_name
      || matchedPlayer.player_name
      || matchedPlayer.name
      || backendUser.account
      || uid
    ).trim();
  },

  normalizeBackendUser(backendUser, rosterList = [], teamsList = [], usersList = []) {
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

    const managedIds = Array.isArray(backendUser.managed_team_ids) ? backendUser.managed_team_ids.map(String) : [];
    const memberIds = Array.isArray(backendUser.member_team_ids) ? backendUser.member_team_ids.map(String) : [];
    const currentSel = String(window.currentSelectedTeamId || '').trim();

    let primaryTeamId = '';
    if (role === 'team_admin') {
      primaryTeamId = (currentSel && managedIds.includes(currentSel) ? currentSel : '')
        || managedIds[0]
        || memberIds[0]
        || matchedPlayer.team_id
        || '';
    } else if (role === 'player') {
      primaryTeamId = (currentSel && memberIds.includes(currentSel) ? currentSel : '')
        || memberIds[0]
        || matchedPlayer.team_id
        || '';
    }

    const teamObj = teamsList.find(t => String(t.team_id) === String(primaryTeamId));
    const displayName = this._resolveDisplayName(uid, backendUser, usersList, rosterList);

    const roleTitleMap = {
      'super_admin': '聯盟最高總管理員',
      'team_admin': teamObj ? `${teamObj.team_name} 管理員` : '球隊管理員 (教練/領隊)',
      'player': `現役隊員${matchedPlayer.number ? ` (#${matchedPlayer.number})` : ''}`
    };

    return {
      user_id: uid,
      account: backendUser.account || uid,
      name: displayName,
      player_name: displayName,
      role: role,
      global_role: backendUser.global_role || 'user',
      team_id: primaryTeamId,
      team_roles_map: backendUser.team_roles_map || {},
      managed_team_ids: managedIds,
      member_team_ids: memberIds,
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
      const usersList = (window.globalData && window.globalData.users) || [];

      if (typeof BBTApi !== 'undefined' && typeof BBTApi.login === 'function') {
        const apiRes = await BBTApi.login(account, password);
        if (apiRes && apiRes.result === 'ok' && apiRes.user) {
          const normalized = this.normalizeBackendUser(apiRes.user, rosterList, teamsList, usersList);
          this.setSession(normalized, apiRes.token || '');
          this.closeLoginModal();
          if (typeof initSystem === 'function') {
            await initSystem();
          }
          return;
        }
        if (apiRes && apiRes.result === 'error' && apiRes.message && !apiRes.message.includes('找不到 Users')) {
          throw new Error(apiRes.message);
        }
      }

      const roleOverrides = JSON.parse(localStorage.getItem(this.ROLE_OVERRIDE_KEY) || '{}');
      const customPasswords = JSON.parse(localStorage.getItem(this.CUSTOM_PWD_KEY) || '{}');

      const matchedUser = usersList.find(u =>
        String(u.account).toLowerCase() === account.toLowerCase() ||
        String(u.user_id).toLowerCase() === account.toLowerCase()
      );
      const matchedPlayer = rosterList.find(r =>
        String(r.user_id).toLowerCase() === account.toLowerCase() ||
        String(r.player_name).trim() === account
      );

      if (!matchedUser && !matchedPlayer && !['admin', 'bbsadmin', 'bbtadmin'].includes(account.toLowerCase())) {
        throw new Error('找不到此帳號或球員代號，請確認輸入是否正確。');
      }

      const uid = matchedUser ? String(matchedUser.user_id) : (matchedPlayer ? String(matchedPlayer.user_id) : '9001');
      const expectedPwd = customPasswords[uid] || customPasswords[account.toLowerCase()] || '1234';
      if (password !== expectedPwd) {
        throw new Error('登入密碼錯誤（預設密碼為 1234）');
      }

      const isSuper = (matchedUser && String(matchedUser.global_role).trim() === 'super_admin')
        || ['admin', 'bbsadmin', 'bbtadmin'].includes(account.toLowerCase());

      let assignedRole = isSuper ? 'super_admin' : (roleOverrides[uid] || 'player');
      if (!isSuper && !roleOverrides[uid] && matchedPlayer) {
        const rType = String(matchedPlayer.role_type || '').toLowerCase();
        if (rType.includes('coach') || rType.includes('leader') || rType.includes('教練') || rType.includes('領隊') || rType.includes('隊長')) {
          assignedRole = 'team_admin';
        }
      }

      const displayName = this._resolveDisplayName(
        uid,
        { ...(matchedUser || {}), ...(matchedPlayer || {}), account },
        usersList,
        rosterList
      );

      const roleTitleMap = {
        'super_admin': '聯盟最高總管理員',
        'team_admin': '球隊管理員 (教練/領隊)',
        'player': `現役隊員${matchedPlayer && matchedPlayer.number ? ` (#${matchedPlayer.number})` : ''}`
      };

      this.setSession({
        user_id: uid,
        account: matchedUser ? matchedUser.account : account,
        name: displayName,
        player_name: displayName,
        role: assignedRole,
        global_role: assignedRole === 'super_admin' ? 'super_admin' : 'user',
        team_id: matchedPlayer ? matchedPlayer.team_id : '',
        title: roleTitleMap[assignedRole] || '聯盟成員'
      });

      this.closeLoginModal();
      if (typeof initSystem === 'function') {
        await initSystem();
      }
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

    const usersList = (window.globalData && window.globalData.users) || [];
    const rosterList = (window.globalData && window.globalData.roster) || [];
    const teamsList = (window.globalData && window.globalData.teams) || [];

    const roleOverrides = JSON.parse(localStorage.getItem(this.ROLE_OVERRIDE_KEY) || '{}');
    const overrideRole = roleOverrides[String(user.user_id || '').trim()];
    const role = overrideRole || user.role || 'player';
    user.role = role;

    const latestUserRow = usersList.find(u => String(u.user_id).trim() === String(user.user_id).trim()) || {};
    const latestRosterRow = rosterList.find(r => String(r.user_id).trim() === String(user.user_id).trim()) || {};
    const resolvedName = this._resolveDisplayName(user.user_id, { ...latestUserRow, ...latestRosterRow, ...user }, usersList, rosterList);

    user.name = resolvedName;
    user.player_name = resolvedName;
    window.currentUser = user;

    const nameEl = document.getElementById('userNameDisplay');
    const titleEl = document.getElementById('userTitleDisplay');
    if (nameEl) nameEl.innerText = resolvedName;
    if (titleEl) titleEl.innerText = user.title || '聯盟成員';

    const btnAuth = document.getElementById('btnAuthAction');
    const btnAuthText = document.getElementById('btnAuthText');
    if (btnAuth) {
      btnAuth.className = "bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-xl transition border border-slate-700 flex items-center space-x-1";
    }
    if (btnAuthText) btnAuthText.innerText = "登出";

    const hasProfile = Boolean(latestRosterRow.user_id || latestUserRow.user_id || user.user_id);
    const btnSelf = document.getElementById('btnOpenSelfProfile');
    if (btnSelf) {
      if (hasProfile) {
        btnSelf.classList.remove('hidden');
        btnSelf.classList.add('flex');
      } else {
        btnSelf.classList.add('hidden');
        btnSelf.classList.remove('flex');
      }
    }

    const btnRoleMgr = document.getElementById('btnOpenAdminRoleMgr');
    const btnCreateAcc = document.getElementById('btnOpenCreateAccount');
    const btnCreateTeamSidebar = document.getElementById('btnSidebarCreateTeam');

    if (role === 'super_admin') {
      if (btnRoleMgr) { btnRoleMgr.classList.remove('hidden'); btnRoleMgr.classList.add('flex'); }
      if (btnCreateAcc) { btnCreateAcc.classList.remove('hidden'); btnCreateAcc.classList.add('flex'); }
      if (btnCreateTeamSidebar) btnCreateTeamSidebar.classList.remove('hidden');
    } else {
      if (btnRoleMgr) { btnRoleMgr.classList.add('hidden'); btnRoleMgr.classList.remove('flex'); }
      if (btnCreateTeamSidebar) btnCreateTeamSidebar.classList.add('hidden');
      if (btnCreateAcc) {
        if (role === 'team_admin') {
          btnCreateAcc.classList.remove('hidden');
          btnCreateAcc.classList.add('flex');
        } else {
          btnCreateAcc.classList.add('hidden');
          btnCreateAcc.classList.remove('flex');
        }
      }
    }

    const leftSidebar = document.getElementById('leftTeamSidebar');
    const rightWorkspace = document.getElementById('rightMainWorkspace');
    const divisionGroup = document.getElementById('divisionFilterGroup');
    const roleBadge = document.getElementById('roleBadge');

    if (role === 'super_admin') {
      if (roleBadge) {
        roleBadge.innerText = "SUPER ADMIN";
        roleBadge.className = "bg-emerald-500/20 text-emerald-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-widest";
      }

      if (leftSidebar) leftSidebar.classList.remove('hidden');
      if (rightWorkspace) rightWorkspace.className = "lg:col-span-8 space-y-5";
      if (divisionGroup) divisionGroup.classList.remove('hidden');

      this.toggleManagementControls(true);

      if (typeof renderTeamSidebar === 'function') renderTeamSidebar();

      if (window.currentSelectedTeamId && teamsList.some(t => String(t.team_id) === String(window.currentSelectedTeamId))) {
        if (typeof selectTeam === 'function') selectTeam(window.currentSelectedTeamId);
      } else {
        window.currentSelectedTeamId = '';
        if (typeof showKpiOverview === 'function') {
          showKpiOverview();
        } else if (typeof renderOverviewKpiBoard === 'function') {
          renderOverviewKpiBoard();
        }
      }
    } else {
      if (leftSidebar) leftSidebar.classList.add('hidden');
      if (rightWorkspace) rightWorkspace.className = "lg:col-span-12 space-y-5";
      if (divisionGroup) divisionGroup.classList.add('hidden');

      const myTeam = teamsList.find(t => String(t.team_id) === String(user.team_id));
      if (myTeam) {
        window.currentDivision = String(myTeam.division).trim() || window.currentDivision;
        if (typeof selectTeam === 'function') selectTeam(myTeam.team_id);
      } else if (typeof renderOverviewKpiBoard === 'function') {
        renderOverviewKpiBoard();
      }

      if (roleBadge) {
        if (role === 'team_admin') {
          roleBadge.innerText = "TEAM ADMIN";
          roleBadge.className = "bg-amber-500/20 text-amber-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-500/30 uppercase tracking-widest";
        } else {
          roleBadge.innerText = "PLAYER";
          roleBadge.className = "bg-sky-500/20 text-sky-300 text-[10px] font-black px-2 py-0.5 rounded-full border border-sky-500/30 uppercase tracking-widest";
        }
      }
      this.toggleManagementControls(role === 'team_admin');
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  toggleManagementControls(canManageTeam) {
    const btnTeamEdit = document.getElementById('btnTeamProfileEdit');
    const btnBatchAtt = document.getElementById('btnBatchAttendance');
    const btnNewAnn = document.getElementById('btnNewAnnouncement');
    const btnEnrollExisting = document.getElementById('btnOpenEnrollExisting');
    const singleAttText = document.getElementById('btnSingleAttendanceText');
    const attHeader = document.getElementById('attendanceHeaderTitle');

    if (canManageTeam) {
      if (btnTeamEdit) btnTeamEdit.classList.remove('hidden');
      if (btnBatchAtt) btnBatchAtt.classList.remove('hidden');
      if (btnNewAnn) btnNewAnn.classList.remove('hidden');
      if (btnEnrollExisting) btnEnrollExisting.classList.remove('hidden');
      if (singleAttText) singleAttText.innerText = '+ 單筆回報';
      if (attHeader) attHeader.innerText = '球員出席回報與請假管理控制台';
    } else {
      if (btnTeamEdit) btnTeamEdit.classList.add('hidden');
      if (btnBatchAtt) btnBatchAtt.classList.add('hidden');
      if (btnNewAnn) btnNewAnn.classList.add('hidden');
      if (btnEnrollExisting) btnEnrollExisting.classList.add('hidden');
      if (singleAttText) singleAttText.innerText = '+ 我要出席回報 / 請假';
      if (attHeader) attHeader.innerText = '我的賽前出勤回報與球隊出賽狀態';
    }
  },

  openSelfProfileModal() {
    const user = this.getCurrentUser();
    if (!user) return;
    const rosterList = (window.globalData && window.globalData.roster) || [];
    const usersList = (window.globalData && window.globalData.users) || [];
    const pObj = rosterList.find(r => String(r.user_id) === String(user.user_id));
    const uObj = usersList.find(u => String(u.user_id) === String(user.user_id));

    if (!pObj && !uObj) {
      alert('此管理員帳號未綁定人員資料');
      return;
    }

    document.getElementById('selfName').value = (uObj && uObj.player_name) || (pObj && pObj.player_name) || user.name || '';
    document.getElementById('selfNumber').value = (pObj && pObj.number) ? `#${pObj.number}` : '由各隊登錄';
    document.getElementById('selfPosition').value = (pObj && pObj.position) || (uObj && uObj.position) || '';
    document.getElementById('selfBatThrow').value = (pObj && pObj.bat_throw) || (uObj && uObj.bat_throw) || '右投右打';
    document.getElementById('selfPhone').value = (pObj && pObj.phone) || (uObj && uObj.phone) || '';
    document.getElementById('selfEmail').value = (uObj && uObj.email) || '';
    document.getElementById('selfNote').value = (uObj && uObj.note) || '';
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
    const position = document.getElementById('selfPosition').value.trim();
    const bat_throw = document.getElementById('selfBatThrow').value;
    const phone = document.getElementById('selfPhone').value.trim();
    const email = document.getElementById('selfEmail').value.trim();
    const note = document.getElementById('selfNote').value.trim();
    const newPwd = document.getElementById('selfNewPassword').value.trim();

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
        email,
        note,
        ...(newPwd ? { new_password: newPwd } : {})
      });
      if (res && res.result === 'error') {
        alert('❌ 更新失敗: ' + (res.message || ''));
        return;
      }
    }

    alert('✅ 個人資料已更新！');
    this.closeSelfProfileModal();
    if (typeof initSystem === 'function') await initSystem();
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
    const usersList = (window.globalData && window.globalData.users) || [];
    const rosterList = (window.globalData && window.globalData.roster) || [];
    const roleOverrides = JSON.parse(localStorage.getItem(this.ROLE_OVERRIDE_KEY) || '{}');

    const options = usersList.map(u => {
      const uid = String(u.user_id || '').trim();
      const rObj = rosterList.find(r => String(r.user_id).trim() === uid && String(r.team_id).trim() === String(teamId).trim());
      const nameLabel = rObj ? `#${rObj.number || '—'} ${rObj.player_name}` : (u.player_name || u.account || uid);
      const curRole = roleOverrides[uid] || u.global_role || '預設';
      return `<option value="${uid}">${nameLabel} (${uid}) [目前: ${curRole}]</option>`;
    });

    userSel.innerHTML = options.length > 0
      ? options.join('')
      : `<option value="">尚無帳號資料</option>`;
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

    const curUser = this.getCurrentUser();
    if (curUser && String(curUser.user_id) === String(userId)) {
      curUser.role = newRole;
      if (newRole === 'team_admin' && teamId) curUser.team_id = teamId;
      this.setSession(curUser, curUser.token || '');
      this.applyRolePermissions();
    }

    alert('✅ 已成功指派該帳號權限！');
    if (typeof initSystem === 'function') await initSystem();
    this.populateRoleMgrPlayerSelect();
  }
};

function submitLogin(e) { return BBTAuth.submitLogin(e); }
function handleAuthButtonClick() { return BBTAuth.handleAuthButtonClick(); }
function openSelfProfileModal() { return BBTAuth.openSelfProfileModal(); }
function closeSelfProfileModal() { return BBTAuth.closeSelfProfileModal(); }
function saveSelfProfile() { return BBTAuth.saveSelfProfile(); }
function openAdminRoleModal() { return BBTAuth.openAdminRoleModal(); }
function closeAdminRoleModal() { return BBTAuth.closeAdminRoleModal(); }
function populateRoleMgrPlayerSelect() { return BBTAuth.populateRoleMgrPlayerSelect(); }
function saveAssignedUserRole() { return BBTAuth.saveAssignedUserRole(); }
