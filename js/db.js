/**
 * ============================================================
 * 库存管理系统 - API 数据访问层
 * ============================================================
 * 通过 HTTP API 调用后端 Python+SQLite 服务器
 * 数据持久化存储在硬盘，不受浏览器缓存影响
 */

const API_BASE = window.location.origin + '/api';

/** 获取存储的认证 token */
function getToken() {
  return localStorage.getItem('inventory_api_token') || '';
}

/** 保存认证 token */
function setToken(token) {
  localStorage.setItem('inventory_api_token', token);
}

/** 清除 token */
function clearToken() {
  localStorage.removeItem('inventory_api_token');
}

/** 通用 fetch 请求 */
async function apiFetch(method, path, body) {
  const url = API_BASE + path;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken()
    }
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = await res.json();

  if (!res.ok) {
    // 401: token 过期，清除登录状态
    if (res.status === 401) {
      clearToken();
      if (window.Auth && window.Auth.currentUser) {
        window.Auth.currentUser = null;
        if (typeof window.updateSidebarUser === 'function') window.updateSidebarUser();
      }
    }
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

// =============================================================
// 以下函数保持与旧版 db.js 同名，方便 app.js 无缝切换
// =============================================================

/** 查全部 */
async function dbGetAll(storeName) {
  return apiFetch('GET', '/' + storeName);
}

/** 按 ID 查单个 */
async function dbGetById(storeName, id) {
  const list = await dbGetAll(storeName);
  return list.find(item => item.id === id) || null;
}

/** 按索引查（前端过滤，因为 SQLite 不建索引也行） */
async function dbGetByIndex(storeName, indexName, value) {
  const list = await dbGetAll(storeName);
  return list.filter(item => item[indexName] === value);
}

/** 新增 */
async function dbAdd(storeName, data) {
  return apiFetch('POST', '/' + storeName, data);
}

/** 修改（必须带 id） */
async function dbPut(storeName, data) {
  return apiFetch('PUT', '/' + storeName, data);
}

/** 删除 */
async function dbDelete(storeName, id) {
  return apiFetch('DELETE', '/' + storeName + '?id=' + id);
}

/** 清空表 */
async function dbClear(storeName) {
  // 通过导入空数组实现清空
  const empty = {};
  empty[storeName] = [];
  return apiFetch('POST', '/import', empty);
}

/** 批量写入（用于导入/恢复） */
async function dbBulkPut(dataMap) {
  return apiFetch('POST', '/import', dataMap);
}

/** 登录调用 */
async function apiLogin(username, password) {
  const res = await fetch(API_BASE + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '登录失败');
  setToken(data.token);
  return data.user;
}

/** 登出 */
function apiLogout() {
  clearToken();
}

/** 获取工作台统计数据 */
async function apiGetDashboardStats() {
  return apiFetch('GET', '/stats/dashboard');
}

/** 导出全部数据 */
async function apiExportAll() {
  return apiFetch('GET', '/export');
}

/** 导入全部数据 */
async function apiImportAll(data) {
  return apiFetch('POST', '/import', data);
}

/** 清空全部数据 */
async function apiClearAll() {
  return apiFetch('POST', '/clear');
}