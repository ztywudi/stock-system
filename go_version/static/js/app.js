/**
 * ============================================================
 * 库存管理系统 - 主应用逻辑 (v2.1)
 * ============================================================
 * 新增：批量出入库、模板管理、数据库安全功能
 */

// =============================================================
// 工具函数
// =============================================================
const Utils = {
  now() { return new Date().toISOString(); },
  fmtDate(d) {
    if (!d) return '-';
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleDateString('zh-CN') + ' ' + dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  },
  fmtShortDate(d) {
    if (!d) return '-';
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleDateString('zh-CN');
  },
  genReceiptNo(type) {
    const p = type === 'in' ? 'IN' : 'OUT';
    const ts = Date.now().toString(36).toUpperCase();
    return `${p}-${ts}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
  },
  toast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 2500);
  },
  openModal(html) {
    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('modalOverlay').classList.add('show');
  },
  closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
  },
  async confirm(msg) {
    return new Promise(resolve => {
      const html = `
        <div class="modal-header"><h3>⚠️ 确认操作</h3>
          <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
        </div>
        <p style="margin:16px 0;">${msg}</p>
        <div class="modal-footer">
          <button class="btn" onclick="Utils.closeModal();resolveCfm(false)">取消</button>
          <button class="btn btn-danger" onclick="Utils.closeModal();resolveCfm(true)">确认</button>
        </div>`;
      window.resolveCfm = resolve;
      Utils.openModal(html);
    });
  },
  download(filename, content, mime = 'application/json') {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  async readUploadFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsText(file, 'UTF-8');
    });
  },
  money(v) { return Number(v || 0).toFixed(2); },
  num(v) { return Number(v || 0); },
};

// =============================================================
// 认证 & 权限管理
// =============================================================
const Auth = {
  currentUser: null,
  SESSION_KEY: 'inventory_user_session',

  async init() {
    const saved = localStorage.getItem(this.SESSION_KEY);
    const token = getToken();
    if (saved && token) {
      try {
        this.currentUser = JSON.parse(saved);
        return true;
      } catch(e) {}
    }
    clearToken();
    localStorage.removeItem(this.SESSION_KEY);
    return false;
  },

  async login(username, password) {
    try {
      const user = await apiLogin(username, password);
      this.currentUser = user;
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
      return true;
    } catch(e) {
      return false;
    }
  },

  logout() {
    this.currentUser = null;
    localStorage.removeItem(this.SESSION_KEY);
    apiLogout();
    updateSidebarUser();
    Pages.navigate('login');
  },

  can(action) {
    if (!this.currentUser) return false;
    const r = this.currentUser.role;
    if (r === 'admin') return true;
    if (r === 'viewer') {
      const ro = ['dashboard','items','categories','transactions','stats','check','login'];
      return ro.includes(action);
    }
    if (r === 'operator') {
      const denied = ['settings','userManage','clearAllData','importData'];
      return !denied.includes(action);
    }
    return false;
  },

  roleName(r) {
    return { admin: '管理员', operator: '操作员', viewer: '只读用户' }[r] || r;
  },
};

// =============================================================
// 页面渲染器
// =============================================================
const Pages = {
  current: 'dashboard',
  _txnMode: 'single', // 'single' or 'batch'

  async navigate(page, skipAuthCheck) {
    if (page !== 'login' && !skipAuthCheck && !Auth.currentUser) {
      page = 'login';
    }
    if (page !== 'login' && !Auth.can(page)) {
      Utils.toast('权限不足，无法访问此页面', 'error');
      return;
    }
    this.current = page;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navEl) navEl.classList.add('active');

    const app = document.getElementById('app');
    if (typeof this[page] === 'function') {
      app.innerHTML = '<div class="text-center text-muted" style="padding:40px;">⏳ 加载中...</div>';
      await this[page](app);
    } else {
      app.innerHTML = '<div class="text-center text-muted" style="padding:40px;">页面开发中...</div>';
    }
  },

  // =========================================================
  // 登录页面
  // =========================================================
  async login(el) {
    if (Auth.currentUser) return this.navigate('dashboard', true);
    el.innerHTML = `
      <div style="max-width:400px;margin:60px auto;padding:40px;background:var(--card-bg);border-radius:12px;box-shadow:var(--shadow);border:1px solid var(--border);">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-size:48px;margin-bottom:8px;">📦</div>
          <h2 style="font-size:20px;">库存管理系统</h2>
          <p class="text-muted" style="font-size:13px;">请登录后使用</p>
        </div>
        <div id="loginError" style="color:var(--danger);font-size:13px;margin-bottom:8px;display:none;"></div>
        <div class="form-group">
          <label>用户名</label>
          <input class="form-control" id="loginUser" placeholder="请输入用户名" autocomplete="username" onkeydown="if(event.key==='Enter') Pages.doLogin()">
        </div>
        <div class="form-group">
          <label>密码</label>
          <input class="form-control" id="loginPass" type="password" placeholder="请输入密码" autocomplete="current-password" onkeydown="if(event.key==='Enter') Pages.doLogin()">
        </div>
        <button class="btn btn-primary w-full" style="justify-content:center;padding:10px;font-size:15px;" onclick="Pages.doLogin()">🔐 登 录</button>
        <div class="text-muted text-center mt-16" style="font-size:12px;">首次使用默认账号：admin / admin123</div>
      </div>`;
  },

  async doLogin() {
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    const errEl = document.getElementById('loginError');
    if (!user || !pass) { errEl.textContent = '请输入用户名和密码'; errEl.style.display = 'block'; return; }
    const ok = await Auth.login(user, pass);
    if (ok) {
      updateSidebarUser();
      Utils.toast(`欢迎回来，${Auth.currentUser.displayName || Auth.currentUser.username}`);
      Pages.navigate('dashboard', true);
    } else {
      errEl.textContent = '用户名或密码错误';
      errEl.style.display = 'block';
    }
  },

  // =========================================================
  // 工作台
  // =========================================================
  async dashboard(el) {
    const items = await dbGetAll('items');
    const txns = await dbGetAll('transactions');
    const cats = await dbGetAll('categories');

    const totalItems = items.length;
    const totalQty = items.reduce((s, i) => s + Utils.num(i.quantity), 0);
    const totalValue = items.reduce((s, i) => s + Utils.num(i.quantity) * Utils.num(i.unitPrice), 0);
    const lowStock = items.filter(i => Utils.num(i.quantity) <= Utils.num(i.minQuantity));
    const todayTxns = txns.filter(t => {
      const td = new Date(t.createdAt).toDateString();
      return td === new Date().toDateString();
    });

    const recent = [...txns].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,10);
    const itemMap = {};
    items.forEach(i => itemMap[i.id] = i);

    const warnHtml = lowStock.length ? `
      <div class="table-wrap mt-16">
        <div class="table-header"><h3>⚠️ 库存预警（${lowStock.length} 项）</h3></div>
        <table><tr><th>名称</th><th>规格</th><th>当前数量</th><th>最低库存</th></tr>
          ${lowStock.map(i => `<tr><td>${i.name}</td><td>${i.spec || '-'}</td><td class="diff-negative">${i.quantity}</td><td>${i.minQuantity||0}</td></tr>`).join('')}
        </table>
      </div>` : '';

    el.innerHTML = `
      <div class="page-header"><div>
        <h2>📊 工作台</h2>
        <div class="subtitle">今天已有 ${todayTxns.length} 笔出入库记录 · 当前用户：${Auth.currentUser ? Auth.currentUser.displayName+' ('+Auth.roleName(Auth.currentUser.role)+')' : '未登录'}</div>
      </div></div>
      <div class="stats-grid">
        <div class="stat-card blue">
          <div class="stat-label">📦 物品种类</div>
          <div class="stat-value">${totalItems}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">📦 总库存数量</div>
          <div class="stat-value">${totalQty}</div>
        </div>
        <div class="stat-card amber">
          <div class="stat-label">💰 库存总价值</div>
          <div class="stat-value">¥${Utils.money(totalValue)}</div>
        </div>
        <div class="stat-card red">
          <div class="stat-label">⚠️ 低于预警</div>
          <div class="stat-value">${lowStock.length}</div>
        </div>
      </div>
      ${warnHtml}
      <div class="table-wrap mt-16">
        <div class="table-header"><h3>最近出入库记录</h3></div>
        ${recent.length ? `<table>
          <tr><th>时间</th><th>类型</th><th>物品</th><th>数量</th><th>金额</th></tr>
          ${recent.map(t => `<tr>
            <td>${Utils.fmtDate(t.createdAt)}</td>
            <td><span class="tag ${t.type === 'in' ? 'tag-in' : 'tag-out'}">${t.type === 'in' ? '入库' : '出库'}</span></td>
            <td>${itemMap[t.itemId] ? itemMap[t.itemId].name : '(已删除)'}</td>
            <td>${t.quantity}</td>
            <td>¥${Utils.money(t.totalPrice)}</td>
          </tr>`).join('')}
        </table>` : `<div class="empty-state"><div class="icon">📭</div><p>暂无数据，先去录入物品和出入库吧！</p></div>`}
      </div>`;
  },

  // =========================================================
  // 分类管理
  // =========================================================
  async categories(el) {
    const cats = await dbGetAll('categories');
    const items = await dbGetAll('items');

    el.innerHTML = `
      <div class="page-header"><div>
        <h2>🏷️ 分类管理</h2>
        <div class="subtitle">管理物品分类，共 ${cats.length} 个分类</div>
      </div></div>
      <div class="table-wrap">
        <div class="table-header">
          <h3>所有分类</h3>
          <div class="table-actions">
            ${Auth.can('settings') ? `<button class="btn btn-primary" onclick="Pages.showCategoryForm()">+ 新增分类</button>` : ''}
          </div>
        </div>
        ${cats.length ? `<table>
          <tr><th>ID</th><th>名称</th><th>说明</th><th>物品数量</th><th>操作</th></tr>
          ${cats.map(c => `<tr>
            <td>${c.id}</td>
            <td><strong>${c.name}</strong></td>
            <td class="text-muted">${c.description || '-'}</td>
            <td>${items.filter(i => i.categoryId == c.id).length}</td>
            <td>
              ${Auth.can('settings') ? `<button class="btn btn-sm" onclick="Pages.showCategoryForm(${c.id})">✏️ 编辑</button>
              <button class="btn btn-sm btn-danger" onclick="Pages.delCategory(${c.id})">🗑️ 删除</button>` : '<span class="text-muted">-</span>'}
            </td>
          </tr>`).join('')}
        </table>` : `<div class="empty-state"><div class="icon">🏷️</div><p>还没有分类，点击上方按钮新增</p></div>`}
      </div>`;
  },

  async showCategoryForm(id) {
    const cat = id ? await dbGetById('categories', id) : {};
    const title = id ? '编辑分类' : '新增分类';
    const html = `
      <div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <input type="hidden" id="cf_id" value="${id || ''}">
      <div class="form-group"><label>分类名称 *</label><input class="form-control" id="cf_name" value="${cat.name || ''}" placeholder="例如：电子元器件"></div>
      <div class="form-group"><label>说明</label><textarea class="form-control" id="cf_desc" rows="3" placeholder="可选描述">${cat.description || ''}</textarea></div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="Pages.saveCategory()">保存</button>
      </div>`;
    Utils.openModal(html);
  },

  async saveCategory() {
    const id = document.getElementById('cf_id').value;
    const name = document.getElementById('cf_name').value.trim();
    if (!name) return Utils.toast('请输入分类名称', 'error');
    const data = { name, description: document.getElementById('cf_desc').value.trim(), updatedAt: Utils.now() };
    if (id) { data.id = Number(id); await dbPut('categories', data); Utils.toast('分类已更新'); }
    else { data.createdAt = Utils.now(); await dbAdd('categories', data); Utils.toast('分类已创建'); }
    Utils.closeModal();
    Pages.navigate('categories');
  },

  async delCategory(id) {
    const ok = await Utils.confirm('确定删除此分类？关联物品不会自动删除。');
    if (!ok) return;
    await dbDelete('categories', id);
    Utils.toast('分类已删除');
    Pages.navigate('categories');
  },

  // =========================================================
  // 物品管理
  // =========================================================
  async items(el) {
    const items = await dbGetAll('items');
    const cats = await dbGetAll('categories');
    const catMap = {}; cats.forEach(c => catMap[c.id] = c.name);

    el.innerHTML = `
      <div class="page-header"><div>
        <h2>📋 物品管理</h2>
        <div class="subtitle">管理所有库存物品，共 ${items.length} 项</div>
      </div></div>
      <div class="table-wrap">
        <div class="table-header">
          <h3>物品列表</h3>
          <div class="table-actions">
            <input class="search-input" id="itemSearch" placeholder="🔍 搜索名称/规格..." oninput="Pages.filterItems()">
            ${Auth.can('items') ? `<button class="btn btn-primary" onclick="Pages.showItemForm()">+ 新增物品</button>` : ''}
          </div>
        </div>
        <div id="itemTableWrap">
        ${items.length ? `<table>
          <tr><th>ID</th><th>名称</th><th>规格型号</th><th>分类</th><th>单位</th><th>单价</th><th>库存</th><th>预警值</th><th>操作</th></tr>
          ${items.map(i => {
              const warn = Utils.num(i.quantity) <= Utils.num(i.minQuantity) ? ' class="diff-negative"' : '';
              return `<tr class="item-row" data-name="${i.name}" data-spec="${i.spec||''}">
                <td>${i.id}</td>
                <td><strong>${i.name}</strong></td>
                <td class="text-muted">${i.spec || '-'}</td>
                <td>${catMap[i.categoryId] || '-'}</td>
                <td>${i.unit || '-'}</td>
                <td>¥${Utils.money(i.unitPrice)}</td>
                <td${warn}>${Utils.num(i.quantity)}</td>
                <td>${i.minQuantity || 0}</td>
                <td>
                  ${Auth.can('items') ? `<button class="btn btn-sm" onclick="Pages.showItemForm(${i.id})">✏️</button>
                  <button class="btn btn-sm btn-danger" onclick="Pages.delItem(${i.id})">🗑️</button>` : '<span class="text-muted">-</span>'}
                </td>
              </tr>`;
          }).join('')}
        </table>` : `<div class="empty-state"><div class="icon">📋</div><p>还没有物品，点击上方按钮新增</p></div>`}
        </div>
      </div>`;
  },

  filterItems() {
    const q = document.getElementById('itemSearch').value.toLowerCase();
    document.querySelectorAll('.item-row').forEach(row => {
      const name = row.dataset.name.toLowerCase();
      const spec = row.dataset.spec.toLowerCase();
      row.style.display = name.includes(q) || spec.includes(q) ? '' : 'none';
    });
  },

  async showItemForm(id) {
    const item = id ? await dbGetById('items', id) : {};
    const cats = await dbGetAll('categories');
    const title = id ? '编辑物品' : '新增物品';
    const catOpts = cats.map(c => `<option value="${c.id}" ${item.categoryId == c.id ? 'selected' : ''}>${c.name}</option>`).join('');

    const html = `
      <div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <input type="hidden" id="if_id" value="${id || ''}">
      <div class="form-row">
        <div class="form-group"><label>物品名称 *</label><input class="form-control" id="if_name" value="${item.name || ''}" placeholder="例如：电阻"></div>
        <div class="form-group"><label>规格型号</label><input class="form-control" id="if_spec" value="${item.spec || ''}" placeholder="例如：10KΩ 0805"></div>
      </div>
      <div class="form-row-3">
        <div class="form-group"><label>分类</label><select class="form-control" id="if_cat"><option value="">无分类</option>${catOpts}</select></div>
        <div class="form-group"><label>单位</label><input class="form-control" id="if_unit" value="${item.unit || ''}" placeholder="个/只/件"></div>
        <div class="form-group"><label>单价 (¥)</label><input class="form-control" id="if_price" type="number" step="0.01" value="${item.unitPrice || ''}" placeholder="0.00"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>初始数量</label><input class="form-control" id="if_qty" type="number" step="1" value="${item.quantity || '0'}" placeholder="0"></div>
        <div class="form-group"><label>最低库存预警</label><input class="form-control" id="if_min" type="number" step="1" value="${item.minQuantity || '0'}" placeholder="0"><div class="hint">低于此值会在工作台显示预警</div></div>
      </div>
      <div class="form-group"><label>存放位置</label><input class="form-control" id="if_loc" value="${item.location || ''}" placeholder="例如：A区-3排-2号"></div>
      <div class="form-group"><label>备注</label><textarea class="form-control" id="if_remark" rows="2">${item.remark || ''}</textarea></div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="Pages.saveItem()">保存</button>
      </div>`;
    Utils.openModal(html);
  },

  async saveItem() {
    const id = document.getElementById('if_id').value;
    const name = document.getElementById('if_name').value.trim();
    if (!name) return Utils.toast('请输入物品名称', 'error');
    const data = {
      name, spec: document.getElementById('if_spec').value.trim(),
      categoryId: Number(document.getElementById('if_cat').value) || 0,
      unit: document.getElementById('if_unit').value.trim(),
      unitPrice: parseFloat(document.getElementById('if_price').value) || 0,
      quantity: parseInt(document.getElementById('if_qty').value) || 0,
      minQuantity: parseInt(document.getElementById('if_min').value) || 0,
      location: document.getElementById('if_loc').value.trim(),
      remark: document.getElementById('if_remark').value.trim(),
      updatedAt: Utils.now()
    };
    if (id) { data.id = Number(id); await dbPut('items', data); Utils.toast('物品已更新'); }
    else { data.createdAt = Utils.now(); await dbAdd('items', data); Utils.toast('物品已新增'); }
    Utils.closeModal();
    Pages.navigate('items');
  },

  async delItem(id) {
    const ok = await Utils.confirm('确定删除此物品？相关的出入库记录不会被删除。');
    if (!ok) return;
    await dbDelete('items', id);
    Utils.toast('物品已删除');
    Pages.navigate('items');
  },

  // =========================================================
  // 入库管理（支持批量）
  // =========================================================
  async in(el) { this._inOutForm(el, 'in'); },

  // =========================================================
  // 出库管理（支持批量）
  // =========================================================
  async out(el) { this._inOutForm(el, 'out'); },

  async _inOutForm(el, type) {
    const items = await dbGetAll('items');
    const label = type === 'in' ? '入库' : '出库';
    const icon = type === 'in' ? '📥' : '📤';
    const isSingle = this._txnMode === 'single';

    // 最近记录
    const txns = (await dbGetByIndex('transactions', 'type', type)).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,20);
    const itemMap = {}; items.forEach(i => itemMap[i.id] = i);

    el.innerHTML = `
      <div class="page-header"><div>
        <h2>${icon} ${label}管理</h2>
        <div class="subtitle">${label}录入与记录</div>
      </div></div>

      <!-- 模式切换 -->
      <div class="table-wrap mb-16">
        <div class="table-header">
          <h3>${label}录入</h3>
          <div class="table-actions">
            <button class="btn ${isSingle?'btn-primary':''}" onclick="Pages._switchTxnMode('${type}','single')">📋 单个录入</button>
            <button class="btn ${!isSingle?'btn-primary':''}" onclick="Pages._switchTxnMode('${type}','batch')">📑 批量录入</button>
          </div>
        </div>

        <!-- 单个录入 -->
        <div style="padding:20px;display:${isSingle?'block':'none'}">
          <div class="form-row">
            <div class="form-group">
              <label>选择物品 *</label>
              <select class="form-control" id="txn_item">
                <option value="">-- 请选择 --</option>
                ${items.map(i => `<option value="${i.id}" data-price="${i.unitPrice}">${i.name} (${i.spec||'无规格'}) - 库存:${i.quantity}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>数量 *</label>
              <input class="form-control" id="txn_qty" type="number" step="1" min="1" placeholder="请输入数量">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>单价 (¥)</label>
              <input class="form-control" id="txn_price" type="number" step="0.01" placeholder="默认取物品单价">
            </div>
            <div class="form-group">
              <label>操作人</label>
              <input class="form-control" id="txn_op" placeholder="谁操作的">
            </div>
          </div>
          <div class="form-group">
            <label>备注</label>
            <input class="form-control" id="txn_remark" placeholder="可选备注">
          </div>
          <button class="btn btn-primary" onclick="Pages.submitTxn('${type}')">✅ 确认${label}</button>
        </div>

        <!-- 批量录入 -->
        <div style="padding:20px;display:${!isSingle?'block':'none'}">
          <div class="form-row mb-16">
            <div class="form-group">
              <label>统一操作人（可选）</label>
              <input class="form-control" id="batch_op" placeholder="留空则每行单独填写">
            </div>
            <div class="form-group">
              <label>统一样注（可选）</label>
              <input class="form-control" id="batch_remark" placeholder="留空则每行单独填写">
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <button class="btn btn-sm btn-primary" onclick="Pages._addBatchRow('${type}')">+ 添加行</button>
            <button class="btn btn-sm" onclick="Pages._loadBatchTemplate('${type}')" ${Auth.can('settings')?'':'disabled'} title="${Auth.can('settings')?'从模板加载':'仅管理员可管理模板'}">📥 从模板加载</button>
            <span class="text-muted ml-8" id="batchCount">共 0 条</span>
          </div>
          <div id="batchRows" style="max-height:50vh;overflow-y:auto;"></div>
          <div style="margin-top:12px;">
            <button class="btn btn-primary" onclick="Pages.submitBatchTxn('${type}')">✅ 批量确认${label}</button>
          </div>
        </div>
      </div>

      <div class="table-wrap">
        <div class="table-header"><h3>最近 ${label}记录</h3></div>
        ${txns.length ? `<table>
          <tr><th>时间</th><th>物品</th><th>数量</th><th>单价</th><th>总金额</th><th>操作人</th><th>备注</th><th>打印</th></tr>
          ${txns.map(t => `<tr>
            <td>${Utils.fmtDate(t.createdAt)}</td>
            <td>${itemMap[t.itemId] ? itemMap[t.itemId].name : '(已删除)'}</td>
            <td>${t.quantity}</td>
            <td>¥${Utils.money(t.unitPrice)}</td>
            <td><strong>¥${Utils.money(t.totalPrice)}</strong></td>
            <td>${t.operator || '-'}</td>
            <td class="text-muted">${t.remark || '-'}</td>
            <td><button class="btn btn-sm" onclick="Pages.printReceipt(${t.id})">🖨️</button></td>
          </tr>`).join('')}
        </table>` : `<div class="empty-state"><div class="icon">${icon}</div><p>暂无${label}记录</p></div>`}
      </div>`;

    // 初始化一行
    if (!isSingle) this._addBatchRow(type);
  },

  _switchTxnMode(type, mode) {
    this._txnMode = mode;
    this._inOutForm(document.getElementById('app'), type);
  },

  _addBatchRow(type) {
    const items = []; // 同步获取
    dbGetAll('items').then(items => {
      const wrap = document.getElementById('batchRows');
      if (!wrap) return;
      const rowId = Date.now();
      const options = items.length ? items.map(i => `<option value="${i.id}" data-price="${i.unitPrice}">${i.name} (${i.spec||'无规格'}) - 库存:${i.quantity}</option>`).join('')
        : '<option>请先添加物品</option>';
      const row = document.createElement('div');
      row.className = 'form-row batch-row';
      row.id = `batch_${rowId}`;
      row.style.cssText = 'align-items:center;padding:8px 0;border-bottom:1px solid var(--border);';
      row.innerHTML = `
        <select style="flex:3;" onchange="Pages._onBatchItemChange(${rowId})">
          <option value="">-- 选择物品 --</option>
          ${options}
        </select>
        <input type="number" step="1" min="1" placeholder="数量" style="flex:1;width:80px;" id="bqty_${rowId}" oninput="Pages._calcBatchRowTotal(${rowId})">
        <input type="number" step="0.01" placeholder="单价" style="flex:1;width:80px;" id="bpri_${rowId}">
        <span style="flex:1;min-width:60px;" id="btotal_${rowId}">¥0.00</span>
        <button class="btn btn-sm btn-danger" onclick="Pages._removeBatchRow(${rowId})">✕</button>`;
      wrap.appendChild(row);
      this._updateBatchCount();
    });
  },

  _onBatchItemChange(rowId) {
    const sel = document.querySelector(`#batch_${rowId} select`);
    const priceInput = document.getElementById(`bpri_${rowId}`);
    if (sel && sel.selectedOptions[0]) {
      const price = sel.selectedOptions[0].dataset.price || 0;
      priceInput.value = price;
    }
    this._calcBatchRowTotal(rowId);
  },

  _calcBatchRowTotal(rowId) {
    const qty = parseFloat(document.getElementById(`bqty_${rowId}`).value) || 0;
    const price = parseFloat(document.getElementById(`bpri_${rowId}`).value) || 0;
    const totalEl = document.getElementById(`btotal_${rowId}`);
    if (totalEl) totalEl.textContent = `¥${Utils.money(qty * price)}`;
    this._updateBatchCount();
  },

  _removeBatchRow(rowId) {
    const row = document.getElementById(`batch_${rowId}`);
    if (row) row.remove();
    this._updateBatchCount();
  },

  _updateBatchCount() {
    const wrap = document.getElementById('batchRows');
    const cnt = wrap ? wrap.querySelectorAll('.batch-row').length : 0;
    const el = document.getElementById('batchCount');
    if (el) el.textContent = `共 ${cnt} 条`;
  },

  async submitBatchTxn(type) {
    const wrap = document.getElementById('batchRows');
    if (!wrap) return;
    const rows = wrap.querySelectorAll('.batch-row');
    if (!rows.length) return Utils.toast('请至少添加一行', 'error');

    const operator = document.getElementById('batch_op')?.value.trim() || '';
    const remark = document.getElementById('batch_remark')?.value.trim() || '';
    const items = await dbGetAll('items');
    const itemMap = {}; items.forEach(i => itemMap[i.id] = i);

    let successCount = 0;
    for (const row of rows) {
      const sel = row.querySelector('select');
      const itemId = parseInt(sel?.value);
      if (!itemId) continue;

      const qty = parseInt(row.querySelector(`input[type="number"]`)?.value) || 0;
      if (qty < 1) continue;

      const price = parseFloat(row.querySelectorAll('input[type="number"]')[1]?.value) || (itemMap[itemId]?.unitPrice || 0);
      const total = qty * price;

      // 出库检查库存
      if (type === 'out' && qty > (itemMap[itemId]?.quantity || 0)) {
        Utils.toast(`${itemMap[itemId]?.name} 库存不足！`, 'error');
        continue;
      }

      // 更新库存
      if (itemMap[itemId]) {
        itemMap[itemId].quantity = type === 'in'
          ? Utils.num(itemMap[itemId].quantity) + qty
          : Utils.num(itemMap[itemId].quantity) - qty;
        itemMap[itemId].updatedAt = Utils.now();
        await dbPut('items', itemMap[itemId]);
      }

      // 记录交易
      await dbAdd('transactions', {
        type, itemId, quantity: qty,
        unitPrice: price, totalPrice: total,
        operator: operator || remark || '',
        remark: (operator && remark) ? `${operator} - ${remark}` : (operator || remark || ''),
        createdAt: Utils.now()
      });
      successCount++;
    }

    if (successCount > 0) {
      Utils.toast(`批量${type === 'in' ? '入库' : '出库'}成功！共 ${successCount} 条`);
      const type2 = type;
      Pages._inOutForm(document.getElementById('app'), type2);
    }
  },

  async _loadBatchTemplate(type) {
    const templates = await dbGetAll('templates');
    const filtered = templates.filter(t => t.type === type);
    if (!filtered.length) return Utils.toast('没有可用的模板', 'error');

    // 简单取第一个匹配模板
    const tpl = filtered[0];
    if (!tpl.content) return;
    const rows = JSON.parse(tpl.content);
    const wrap = document.getElementById('batchRows');
    if (!wrap) return;
    wrap.innerHTML = '';
    rows.forEach(r => {
      this._addBatchRow(type);
      const lastRow = wrap.lastElementChild;
      if (lastRow) {
        const sel = lastRow.querySelector('select');
        if (sel) sel.value = r.itemId || '';
        const qtyInput = lastRow.querySelector('input[type="number"]');
        if (qtyInput) qtyInput.value = r.quantity || '';
        this._onBatchItemChange(parseInt(lastRow.id.split('_')[1]));
      }
    });
    Utils.toast(`已加载模板：${tpl.name}`);
  },

  async submitTxn(type) {
    const itemId = Number(document.getElementById('txn_item').value);
    const qty = parseInt(document.getElementById('txn_qty').value);
    const price = parseFloat(document.getElementById('txn_price').value);
    const operator = document.getElementById('txn_op').value.trim();
    const remark = document.getElementById('txn_remark').value.trim();

    if (!itemId) return Utils.toast('请选择物品', 'error');
    if (!qty || qty < 1) return Utils.toast('请输入有效数量', 'error');

    const item = await dbGetById('items', itemId);
    if (!item) return Utils.toast('物品不存在', 'error');

    const unitPrice = price > 0 ? price : Utils.num(item.unitPrice);
    const totalPrice = qty * unitPrice;

    // 出库检查库存
    if (type === 'out' && qty > Utils.num(item.quantity)) {
      return Utils.toast(`库存不足！当前库存: ${item.quantity}`, 'error');
    }

    // 更新库存
    item.quantity = type === 'in'
      ? Utils.num(item.quantity) + qty
      : Utils.num(item.quantity) - qty;
    item.updatedAt = Utils.now();
    await dbPut('items', item);

    // 记录交易
    await dbAdd('transactions', {
      type, itemId, quantity: qty,
      unitPrice, totalPrice,
      operator, remark,
      createdAt: Utils.now()
    });

    Utils.toast(`${type === 'in' ? '入库' : '出库'}成功！${item.name} x ${qty}`);
    // 清空表单
    document.getElementById('txn_qty').value = '';
    document.getElementById('txn_price').value = '';
    document.getElementById('txn_op').value = '';
    document.getElementById('txn_remark').value = '';
    // 刷新页面
    Pages._inOutForm(document.getElementById('app'), type);
  },

  // =========================================================
  // 打印单据
  // =========================================================
  async printReceipt(txnId) {
    const txn = await dbGetById('transactions', txnId);
    if (!txn) return Utils.toast('记录不存在', 'error');
    const item = await dbGetById('items', txn.itemId);
    const label = txn.type === 'in' ? '入库单' : '出库单';
    const no = Utils.genReceiptNo(txn.type);

    const html = `
      <div class="modal-header"><h3>🖨️ ${label}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <div class="print-receipt" id="receiptContent">
        <h2>${label}</h2>
        <div class="info-line"><span>单号：</span><span>${no}</span></div>
        <div class="info-line"><span>日期：</span><span>${Utils.fmtDate(txn.createdAt)}</span></div>
        <div class="info-line"><span>操作人：</span><span>${txn.operator || '-'}</span></div>
        <hr style="margin:8px 0;">
        <table>
          <tr><th>物品</th><th>规格</th><th>数量</th><th>单价</th><th>金额</th></tr>
          <tr>
            <td>${item ? item.name : '(已删除)'}</td>
            <td>${item ? (item.spec || '-') : '-'}</td>
            <td>${txn.quantity}</td>
            <td>¥${Utils.money(txn.unitPrice)}</td>
            <td>¥${Utils.money(txn.totalPrice)}</td>
          </tr>
        </table>
        <div class="total-line">合计：¥${Utils.money(txn.totalPrice)}</div>
        <div class="info-line" style="margin-top:8px;"><span>备注：</span><span>${txn.remark || '-'}</span></div>
        <div style="text-align:center;margin-top:16px;color:var(--text-secondary);font-size:11px;">打印时间：${Utils.fmtDate(new Date())}</div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">关闭</button>
        <button class="btn btn-primary" onclick="window.print()">🖨️ 打印</button>
      </div>`;
    Utils.openModal(html);
  },

  // =========================================================
  // 出入库记录总览
  // =========================================================
  async transactions(el) {
    const txns = (await dbGetAll('transactions')).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    const items = await dbGetAll('items');
    const itemMap = {}; items.forEach(i => itemMap[i.id] = i);

    el.innerHTML = `
      <div class="page-header"><div>
        <h2>📜 出入库记录</h2>
        <div class="subtitle">全部历史记录，共 ${txns.length} 条</div>
      </div></div>
      <div class="table-wrap">
        <div class="table-header">
          <h3>全部记录</h3>
          <div class="table-actions">
            <input class="search-input" id="txnSearch" placeholder="🔍 搜索物品..." oninput="Pages.filterTxns()">
          </div>
        </div>
        <div id="txnTableWrap">
        ${txns.length ? `<table>
          <tr><th>时间</th><th>类型</th><th>物品</th><th>数量</th><th>单价</th><th>总金额</th><th>操作人</th><th>备注</th><th>打印</th></tr>
          ${txns.map(t => {
              const iname = itemMap[t.itemId] ? itemMap[t.itemId].name : '(已删除)';
              return `<tr class="txn-row" data-item="${iname}">
                <td>${Utils.fmtDate(t.createdAt)}</td>
                <td><span class="tag ${t.type === 'in' ? 'tag-in' : 'tag-out'}">${t.type === 'in' ? '入库' : '出库'}</span></td>
                <td>${iname}</td>
                <td>${t.quantity}</td>
                <td>¥${Utils.money(t.unitPrice)}</td>
                <td><strong>¥${Utils.money(t.totalPrice)}</strong></td>
                <td>${t.operator || '-'}</td>
                <td class="text-muted">${t.remark || '-'}</td>
                <td><button class="btn btn-sm" onclick="Pages.printReceipt(${t.id})">🖨️</button></td>
              </tr>`;
          }).join('')}
        </table>` : `<div class="empty-state"><div class="icon">📜</div><p>暂无记录</p></div>`}
        </div>
      </div>`;
  },

  filterTxns() {
    const q = document.getElementById('txnSearch').value.toLowerCase();
    document.querySelectorAll('.txn-row').forEach(row => {
      row.style.display = row.dataset.item.toLowerCase().includes(q) ? '' : 'none';
    });
  },

  // =========================================================
  // 库存盘点
  // =========================================================
  async check(el) {
    const checks = (await dbGetAll('checks')).sort((a,b) => new Date(b.checkDate) - new Date(a.checkDate));
    const items = await dbGetAll('items');

    el.innerHTML = `
      <div class="page-header"><div>
        <h2>🔍 库存盘点</h2>
        <div class="subtitle">盘点和核对实际库存，共 ${checks.length} 次盘点记录</div>
      </div></div>
      <div class="table-wrap mb-16">
        <div class="table-header"><h3>开始新盘点</h3></div>
        <div style="padding:20px;">
          <p class="mb-16 text-muted">创建一个新的盘点任务，逐一核对实际库存数量。</p>
          ${Auth.can('items') ? `<button class="btn btn-primary" onclick="Pages.startCheck()">🔍 开始新盘点</button>` : '<span class="text-muted">只读用户无法创建盘点</span>'}
        </div>
      </div>
      <div class="table-wrap">
        <div class="table-header"><h3>盘点历史</h3></div>
        ${checks.length ? `<table>
          <tr><th>盘点日期</th><th>盘点项数</th><th>差异项</th><th>状态</th><th>操作</th></tr>
          ${checks.map(c => {
              const diffItems = (c.items || []).filter(it => it.diff !== 0);
              return `<tr>
                <td>${Utils.fmtDate(c.checkDate)}</td>
                <td>${(c.items||[]).length}</td>
                <td class="${diffItems.length ? 'diff-negative' : ''}">${diffItems.length}</td>
                <td><span class="tag ${c.status === 'completed' ? 'tag-ok' : 'tag-warn'}">${c.status === 'completed' ? '已完成' : '草稿'}</span></td>
                <td><button class="btn btn-sm" onclick="Pages.viewCheck(${c.id})">👁️ 查看</button></td>
              </tr>`;
          }).join('')}
        </table>` : `<div class="empty-state"><div class="icon">🔍</div><p>暂无盘点记录</p></div>`}
      </div>`;
  },

  async startCheck() {
    const items = await dbGetAll('items');
    if (!items.length) return Utils.toast('请先添加物品', 'error');

    const html = `
      <div class="modal-header"><h3>🔍 新建盘点</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <p class="mb-16">逐项填写实际库存数量，系统会自动计算差异。</p>
      <div style="max-height:50vh;overflow-y:auto;">
        <table>
          <tr><th>物品</th><th>规格</th><th>账面数量</th><th>实际数量</th><th>差异</th></tr>
          ${items.map(i => `<tr>
            <td>${i.name}</td>
            <td class="text-muted">${i.spec || '-'}</td>
            <td class="text-right" id="exp_${i.id}">${Utils.num(i.quantity)}</td>
            <td><input class="form-control" style="width:80px;" type="number" step="1" id="act_${i.id}" value="${Utils.num(i.quantity)}" oninput="Pages.calcDiff(${i.id})"></td>
            <td class="text-right" id="diff_${i.id}">0</td>
          </tr>`).join('')}
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="Pages.saveCheck()">💾 保存盘点</button>
      </div>`;
    Utils.openModal(html);
  },

  calcDiff(id) {
    const exp = Utils.num(document.getElementById(`exp_${id}`).textContent);
    const act = Utils.num(document.getElementById(`act_${id}`).value);
    const diff = act - exp;
    const el = document.getElementById(`diff_${id}`);
    el.textContent = diff;
    el.className = `text-right ${diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : ''}`;
  },

  async saveCheck() {
    const items = await dbGetAll('items');
    const checkItems = items.map(i => ({
      itemId: i.id,
      expectedQty: Utils.num(i.quantity),
      actualQty: Utils.num(document.getElementById(`act_${i.id}`).value),
    }));
    checkItems.forEach(c => c.diff = c.actualQty - c.expectedQty);

    const check = {
      checkDate: Utils.now(),
      status: 'completed',
      items: checkItems,
      createdAt: Utils.now()
    };
    await dbAdd('checks', check);

    // 自动更新库存为实际数量
    const diffItems = checkItems.filter(c => c.diff !== 0);
    if (diffItems.length) {
      for (const c of diffItems) {
        if (c.diff !== 0) {
          const item = items.find(i => i.id === c.itemId);
          if (item) {
            item.quantity = c.actualQty;
            item.updatedAt = Utils.now();
            await dbPut('items', item);
          }
        }
      }
      Utils.toast(`盘点完成，${diffItems.length} 项差异已自动修正库存`);
    } else {
      Utils.toast('盘点完成，所有物品账实相符 ✅');
    }
    Utils.closeModal();
    Pages.navigate('check');
  },

  async viewCheck(id) {
    const check = await dbGetById('checks', id);
    if (!check) return Utils.toast('盘点记录不存在', 'error');
    const items = await dbGetAll('items');
    const itemMap = {}; items.forEach(i => itemMap[i.id] = i);

    const html = `
      <div class="modal-header"><h3>🔍 盘点详情</h3>
        <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
      </div>
      <p>盘点时间：${Utils.fmtDate(check.checkDate)} &nbsp;|&nbsp; 状态：${check.status === 'completed' ? '✅ 已完成' : '📝 草稿'}</p>
      <div style="max-height:50vh;overflow-y:auto;margin-top:12px;">
        <table>
          <tr><th>物品</th><th>账面</th><th>实际</th><th>差异</th></tr>
          ${(check.items||[]).map(c => {
              const iname = itemMap[c.itemId] ? itemMap[c.itemId].name : '(已删除)';
              const cls = c.diff > 0 ? 'diff-positive' : c.diff < 0 ? 'diff-negative' : '';
              return `<tr><td>${iname}</td><td>${c.expectedQty}</td><td>${c.actualQty}</td><td class="${cls}">${c.diff > 0 ? '+' : ''}${c.diff}</td></tr>`;
          }).join('')}
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">关闭</button>
      </div>`;
    Utils.openModal(html);
  },

  // =========================================================
  // 统计报表
  // =========================================================
  async stats(el) {
    const items = await dbGetAll('items');
    const cats = await dbGetAll('categories');
    const txns = await dbGetAll('transactions');
    const catMap = {}; cats.forEach(c => catMap[c.id] = c.name);

    // 按分类统计
    const catStats = {};
    items.forEach(i => {
      const cn = catMap[i.categoryId] || '未分类';
      if (!catStats[cn]) catStats[cn] = { count: 0, qty: 0, value: 0 };
      catStats[cn].count++;
      catStats[cn].qty += Utils.num(i.quantity);
      catStats[cn].value += Utils.num(i.quantity) * Utils.num(i.unitPrice);
    });
    const catKeys = Object.keys(catStats);

    // 近30天出入库趋势
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30*24*60*60*1000);
    const recentTxns = txns.filter(t => new Date(t.createdAt) >= thirtyDaysAgo);

    const dailyStats = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i*24*60*60*1000);
      const key = d.toLocaleDateString('zh-CN');
      dailyStats[key] = { in: 0, out: 0 };
    }
    recentTxns.forEach(t => {
      const key = new Date(t.createdAt).toLocaleDateString('zh-CN');
      if (dailyStats[key]) dailyStats[key][t.type] += Utils.num(t.totalPrice);
    });
    const trendDays = Object.keys(dailyStats);
    const trendIn = trendDays.map(d => dailyStats[d].in);
    const trendOut = trendDays.map(d => dailyStats[d].out);

    // 库存价值TOP10
    const byVal = [...items].sort((a,b) => (Utils.num(b.quantity)*Utils.num(b.unitPrice)) - (Utils.num(a.quantity)*Utils.num(a.unitPrice))).slice(0,10);

    // 计算最大柱高
    const maxVal = Math.max(...byVal.map(i => Utils.num(i.quantity)*Utils.num(i.unitPrice)), 1);

    el.innerHTML = `
      <div class="page-header"><div>
        <h2>📈 统计报表</h2>
        <div class="subtitle">库存数据多维度分析</div>
      </div></div>
      <div class="stats-grid">
        <div class="stat-card blue">
          <div class="stat-label">物品总数</div>
          <div class="stat-value">${items.length}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">总库存量</div>
          <div class="stat-value">${items.reduce((s,i) => s + Utils.num(i.quantity), 0)}</div>
        </div>
        <div class="stat-card amber">
          <div class="stat-label">总价值</div>
          <div class="stat-value">¥${Utils.money(items.reduce((s,i) => s + Utils.num(i.quantity)*Utils.num(i.unitPrice), 0))}</div>
        </div>
        <div class="stat-card red">
          <div class="stat-label">本月交易笔数</div>
          <div class="stat-value">${recentTxns.length}</div>
        </div>
      </div>
      <div class="chart-container">
        <h3>按分类统计</h3>
        ${catKeys.length ? `<div class="bar-chart">
          ${catKeys.map(k => {
            const pct = catStats[k].value / Math.max(...catKeys.map(k2 => catStats[k2].value), 1) * 100;
            return `<div class="bar-item"><div class="bar" style="height:${Math.max(pct,2)}%;background:var(--primary);"></div><div class="bar-label">${k}</div></div>`;
          }).join('')}
        </div>` : `<p class="text-muted">暂无数据</p>`}
        <div class="form-row-3 mt-16" style="text-align:center;">
          ${catKeys.map(k => `<div><strong>${k}</strong><br><span class="text-muted">${catStats[k].count} 种 / ${catStats[k].qty} 件 / ¥${Utils.money(catStats[k].value)}</span></div>`).join('')}
        </div>
      </div>
      <div class="chart-container">
        <h3>近30天出入库金额趋势</h3>
        ${trendDays.length ? `<div class="bar-chart" style="height:160px;">
          ${trendDays.map((d, i) => {
            const maxAmt = Math.max(...trendIn, ...trendOut, 1);
            const hIn = trendIn[i] / maxAmt * 100;
            const hOut = trendOut[i] / maxAmt * 100;
            return `<div class="bar-item" style="justify-content:flex-end;gap:2px;">
              <div class="bar" style="height:${Math.max(hIn,1)}%;background:var(--success);min-height:0;"></div>
              <div class="bar" style="height:${Math.max(hOut,1)}%;background:var(--danger);min-height:0;"></div>
              <div class="bar-label" style="font-size:9px;">${d.slice(5)}</div>
            </div>`;
          }).join('')}
        </div>` : `<p class="text-muted">暂无数据</p>`}
        <div class="mt-8 text-muted" style="font-size:12px;"><span style="color:var(--success);">■</span> 入库 &nbsp; <span style="color:var(--danger);">■</span> 出库</div>
      </div>
      <div class="chart-container">
        <h3>库存价值 TOP 10</h3>
        ${byVal.length ? `<div class="bar-chart">
          ${byVal.map(i => {
            const v = Utils.num(i.quantity) * Utils.num(i.unitPrice);
            const pct = v / maxVal * 100;
            return `<div class="bar-item"><div class="bar" style="height:${Math.max(pct,2)}%"></div><div class="bar-label">${i.name}</div></div>`;
          }).join('')}
        </div>` : `<p class="text-muted">暂无数据</p>`}
      </div>`;
  },

  // =========================================================
  // 导入/导出/备份 + 模板管理
  // =========================================================
  async tools(el) {
    el.innerHTML = `
      <div class="page-header"><div>
        <h2>🛠️ 导入 / 导出 / 备份</h2>
        <div class="subtitle">数据迁移与安全备份</div>
      </div></div>
      <div class="stats-grid">
        <div class="stat-card blue" style="cursor:pointer;" onclick="Pages.exportData()">
          <div class="stat-label">📤 导出数据</div>
          <div class="stat-value" style="font-size:16px;">导出为 JSON 文件</div>
          <div class="stat-change text-muted">备份全部数据到本地</div>
        </div>
        <div class="stat-card green" style="cursor:pointer;${Auth.can('settings')?'':'opacity:0.5;'}" onclick="${Auth.can('settings')?'Pages.importData()':'Utils.toast(\'仅管理员可导入数据\',\'error\')'}">
          <div class="stat-label">📥 导入数据</div>
          <div class="stat-value" style="font-size:16px;">从 JSON 文件导入</div>
          <div class="stat-change text-muted">${Auth.can('settings')?'恢复或迁移数据':'🔒 仅管理员可用'}</div>
        </div>
        <div class="stat-card amber" style="cursor:pointer;" onclick="Pages.exportCSV()">
          <div class="stat-label">📊 导出 CSV</div>
          <div class="stat-value" style="font-size:16px;">导出物品列表为 CSV</div>
          <div class="stat-change text-muted">可用 Excel 打开</div>
        </div>
        <div class="stat-card red" style="cursor:pointer;${Auth.can('settings')?'':'opacity:0.5;'}" onclick="${Auth.can('settings')?'Pages.clearAllData()':'Utils.toast(\'仅管理员可清空数据\',\'error\')'}">
          <div class="stat-label">⚠️ 清空数据</div>
          <div class="stat-value" style="font-size:16px;">删除全部数据</div>
          <div class="stat-change text-muted">${Auth.can('settings')?'谨慎操作！不可恢复':'🔒 仅管理员可用'}</div>
        </div>
      </div>

      <!-- 模板管理 -->
      <div class="table-wrap mt-16">
        <div class="table-header">
          <h3>📋 出入库模板管理</h3>
          <div class="table-actions">
            ${Auth.can('settings') ? `<button class="btn btn-primary" onclick="Pages.showTemplateForm()">+ 新建模板</button>` : ''}
          </div>
        </div>
        <div id="templateWrap"></div>
      </div>

      <div class="table-wrap mt-16">
        <div class="table-header"><h3>说明</h3></div>
        <div style="padding:20px;">
          <p><strong>📤 导出数据</strong>：将全部数据（物品、分类、出入库、盘点记录）导出为 JSON 文件。</p>
          <p class="mt-8"><strong>📥 导入数据</strong>：从之前导出的 JSON 文件恢复数据。会覆盖当前数据库中的全部数据。</p>
          <p class="mt-8"><strong>📊 导出 CSV</strong>：将物品清单导出为 CSV 格式，可用 Excel / WPS 打开编辑，编辑后可再导入。</p>
          <p class="mt-8"><strong>📋 模板管理</strong>：创建常用出入库模板，批量操作时可直接加载，提高效率。</p>
          <p class="mt-8"><strong>🔒 数据安全</strong>：定期导出 JSON 备份并存放到安全位置。清除浏览器缓存<strong>不会</strong>影响数据！</p>
        </div>
      </div>`;

    // 加载模板列表
    this._renderTemplateList();
  },

  async _renderTemplateList() {
    const wrap = document.getElementById('templateWrap');
    if (!wrap) return;
    const templates = await dbGetAll('templates');
    if (!templates.length) {
      wrap.innerHTML = '<div class="empty-state"><p>暂无模板，点击上方按钮新建</p></div>';
      return;
    }
    wrap.innerHTML = `<table>
      <tr><th>模板名称</th><th>类型</th><th>物品数</th><th>创建时间</th><th>操作</th></tr>
      ${templates.map(t => `<tr>
        <td><strong>${t.name}</strong></td>
        <td><span class="tag ${t.type === 'in' ? 'tag-in' : 'tag-out'}">${t.type === 'in' ? '入库' : '出库'}</span></td>
        <td>${(JSON.parse(t.content||'[]')).length}</td>
        <td class="text-muted">${Utils.fmtShortDate(t.createdAt)}</td>
        <td>
          ${Auth.can('settings') ? `<button class="btn btn-sm" onclick="Pages.exportTemplate(${t.id})">📤 导出</button>
          <button class="btn btn-sm" onclick="Pages.delTemplate(${t.id})">🗑️ 删除</button>` : '<span class="text-muted">-</span>'}
        </td>
      </tr>`).join('')}
    </table>`;
  },

  async showTemplateForm(id) {
    const tpl = id ? await dbGetById('templates', id) : {};
    const title = id ? '编辑模板' : '新建模板';
    const items = await dbGetAll('items');

    // 构建模板内容编辑器（简单版：JSON 文本）
    const html = `
      <div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <input type="hidden" id="tpl_id" value="${id || ''}">
      <div class="form-row">
        <div class="form-group">
          <label>模板名称 *</label>
          <input class="form-control" id="tpl_name" value="${tpl.name || ''}" placeholder="例如：常用入库模板">
        </div>
        <div class="form-group">
          <label>类型</label>
          <select class="form-control" id="tpl_type">
            <option value="in" ${tpl.type==='in'?'selected':''}>入库</option>
            <option value="out" ${tpl.type==='out'?'selected':''}>出库</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>模板内容（JSON 格式，每行一个物品）</</label>
        <textarea class="form-control" id="tpl_content" rows="8" placeholder='[{"itemId":1,"quantity":10},{"itemId":2,"quantity":5}]'>${tpl.content || ''}</textarea>
        <div class="hint">格式：JSON 数组，每项包含 itemId 和 quantity 字段</div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="Pages.saveTemplate()">保存</button>
      </div>`;
    Utils.openModal(html);
  },

  async saveTemplate() {
    const id = document.getElementById('tpl_id').value;
    const name = document.getElementById('tpl_name').value.trim();
    const type = document.getElementById('tpl_type').value;
    const content = document.getElementById('tpl_content').value.trim();
    if (!name) return Utils.toast('请输入模板名称', 'error');
    if (!content) return Utils.toast('请输入模板内容', 'error');
    try { JSON.parse(content); } catch(e) { return Utils.toast('JSON 格式错误：' + e.message, 'error'); }

    const data = { name, type, content, updatedAt: Utils.now() };
    if (id) { data.id = Number(id); await dbPut('templates', data); Utils.toast('模板已更新'); }
    else { data.createdAt = Utils.now(); await dbAdd('templates', data); Utils.toast('模板已创建'); }
    Utils.closeModal();
    Pages._renderTemplateList();
  },

  async exportTemplate(id) {
    const tpl = await dbGetById('templates', id);
    if (!tpl) return Utils.toast('模板不存在', 'error');
    Utils.download(`模板_${tpl.name}.json`, tpl.content, 'application/json');
    Utils.toast('模板已导出');
  },

  async delTemplate(id) {
    const ok = await Utils.confirm('确定删除此模板？');
    if (!ok) return;
    await dbDelete('templates', id);
    Utils.toast('模板已删除');
    Pages._renderTemplateList();
  },

  async exportData() {
    try {
      const data = await apiExportAll();
      const json = JSON.stringify(data, null, 2);
      Utils.download(`库存备份_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.json`, json);
      Utils.toast('数据已导出');
    } catch(e) {
      Utils.toast('导出失败: ' + e.message, 'error');
    }
  },

  importData() {
    const html = `
      <div class="modal-header"><h3>📥 导入数据</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <div class="form-group">
        <label>选择备份文件 (.json)</label>
        <input class="form-control" type="file" id="importFile" accept=".json">
        <div class="hint">⚠️ 导入会覆盖当前数据库中的全部数据！</div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="Pages.doImport()">导入并覆盖</button>
      </div>`;
    Utils.openModal(html);
  },

  async doImport() {
    const file = document.getElementById('importFile').files[0];
    if (!file) return Utils.toast('请选择文件', 'error');
    try {
      const text = await Utils.readUploadFile(file);
      const data = JSON.parse(text);
      await apiImportAll(data);
      Utils.toast('导入成功！');
      Utils.closeModal();
      Pages.navigate('dashboard');
    } catch(e) {
      Utils.toast('导入失败：' + e.message, 'error');
    }
  },

  async exportCSV() {
    const items = await dbGetAll('items');
    const cats = await dbGetAll('categories');
    const catMap = {}; cats.forEach(c => catMap[c.id] = c.name);

    const headers = ['ID', '名称', '规格型号', '分类', '单位', '单价', '库存数量', '最低预警', '存放位置', '备注'];
    const rows = items.map(i => [
      i.id, i.name, i.spec, catMap[i.categoryId]||'', i.unit, i.unitPrice, i.quantity, i.minQuantity||0, i.location||'', i.remark||''
    ]);

    // CSV 转义
    const esc = v => `"${String(v||'').replace(/"/g, '""')}"`;
    const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');

    Utils.download(`物品清单_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.csv`, csv, 'text/csv');
    Utils.toast('CSV 已导出');
  },

  async clearAllData() {
    const ok = await Utils.confirm('⚠️ 确定要清空所有数据？此操作不可恢复！\n建议先导出备份。');
    if (!ok) return;
    const ok2 = await Utils.confirm('再次确认：真的要删除全部数据吗？');
    if (!ok2) return;
    try {
      await apiClearAll();
      Utils.toast('所有数据已清空');
    } catch(e) {
      Utils.toast('清空失败：' + e.message, 'error');
    }
    Pages.navigate('dashboard');
  },

  // =========================================================
  // 系统设置 / 用户管理 / 数据库安全
  // =========================================================
  async settings(el) {
    const items = await dbGetAll('items');
    const txns = await dbGetAll('transactions');
    const estimateSize = items.length * 0.5 + txns.length * 0.3;

    el.innerHTML = `
      <div class="page-header"><div>
        <h2>⚙️ 系统设置</h2>
        <div class="subtitle">系统信息与用户管理</div>
      </div></div>

      <div class="table-wrap mb-16">
        <div class="table-header"><h3>系统信息</h3></div>
        <div style="padding:20px;">
          <div class="form-row-3">
            <div><strong>系统版本</strong><br><span class="text-muted">v2.1 (新增批量出入库、模板管理、数据库安全)</span></div>
            <div><strong>数据引擎</strong><br><span class="text-muted">SQLite (Go版) / JSON (Python版)</span></div>
            <div><strong>数据量</strong><br><span class="text-muted">约 ${estimateSize.toFixed(1)} KB</span></div>
          </div>
          <div class="form-row-3 mt-16">
            <div><strong>物品总数</strong><br><span class="text-muted">${items.length} 项</span></div>
            <div><strong>出入库记录</strong><br><span class="text-muted">${txns.length} 条</span></div>
            <div><strong>局域网访问</strong><br><span class="text-muted">运行 start.bat 即可</span></div>
          </div>
        </div>
      </div>

      <!-- 数据库安全 -->
      <div class="table-wrap mb-16">
        <div class="table-header"><h3>🔒 数据库安全</h3></div>
        <div style="padding:20px;">
          <p class="text-muted mb-16">以下功能用于保护数据安全，防止误删或非法访问。</p>
          <div class="form-row">
            <div class="form-group">
              <label>自动备份</label>
              <button class="btn btn-sm" onclick="Pages._toggleAutoBackup()">📤 开启自动备份</button>
              <div class="hint">每日自动导出 JSON 备份到下载文件夹</div>
            </div>
            <div class="form-group">
              <label>数据完整性校验</label>
              <button class="btn btn-sm" onclick="Pages._verifyData()">🔍 校验现在</button>
              <div class="hint">检查数据引用完整性（如出入库记录对应的物品是否存在）</div>
            </div>
          </div>
          <div id="verifyResult" class="mt-16"></div>
        </div>
      </div>

      <!-- 用户管理（管理员专用） -->
      ${Auth.can('settings') ? `<div class="table-wrap mb-16">
        <div class="table-header">
          <h3>👥 用户管理</h3>
          <div class="table-actions">
            <button class="btn btn-primary" onclick="Pages.showUserForm()">+ 新增用户</button>
          </div>
        </div>
        <div id="userManageWrap"></div>
      </div>` : ''}

      <!-- 快速使用说明 -->
      <div class="table-wrap">
        <div class="table-header"><h3>📖 快速使用说明</h3></div>
        <div style="padding:20px;line-height:2;">
          <p>1️⃣ <strong>先建分类</strong> → 进入「分类管理」新增分类（如：电子元器件、办公用品）</p>
          <p>2️⃣ <strong>再建物品</strong> → 进入「物品管理」添加具体的物品（名称、规格、单价等）</p>
          <p>3️⃣ <strong>出入库操作</strong> → 在「入库管理」或「出库管理」中选择物品录入（支持批量！）</p>
          <p>4️⃣ <strong>定期盘点</strong> → 进入「库存盘点」核对实际库存，差异会自动修正</p>
          <p>5️⃣ <strong>数据安全</strong> → 定期在「导入/导出/备份」中导出 JSON 备份</p>
          <p>6️⃣ <strong>模板管理</strong> → 在「导入/导出/备份」中创建常用出入库模板，提高效率</p>
        </div>
      </div>`;

    // 加载用户列表
    if (Auth.can('settings')) this._renderUserList();
  },

  /** 数据完整性校验 */
  async _verifyData() {
    const items = await dbGetAll('items');
    const txns = await dbGetAll('transactions');
    const users = await dbGetAll('users');
    const itemIds = new Set(items.map(i => i.id));

    const orphanTxns = txns.filter(t => !itemIds.has(t.itemId));
    const resultEl = document.getElementById('verifyResult');

    if (!orphanTxns.length) {
      resultEl.innerHTML = '<div style="color:var(--success);padding:8px;background:var(--card-bg);border-radius:8px;">✅ 数据完整性校验通过！没有发现孤立记录。</div>';
    } else {
      resultEl.innerHTML = `<div style="color:var(--warning);padding:8px;background:var(--card-bg);border-radius:8px;">
        ⚠️ 发现 ${orphanTxns.length} 条出入库记录引用的物品已删除。
        <button class="btn btn-sm" onclick="Pages._cleanOrphanTxns()">🗑️ 清理孤立记录</button>
      </div>`;
    }
  },

  async _cleanOrphanTxns() {
    const ok = await Utils.confirm('确定清理所有孤立的出入库记录？（此操作不可恢复）');
    if (!ok) return;
    const items = await dbGetAll('items');
    const itemIds = new Set(items.map(i => i.id));
    const txns = await dbGetAll('transactions');
    const validTxns = txns.filter(t => itemIds.has(t.itemId));
    // 重建 transactions 表
    await apiImportAll({ transactions: validTxns });
    Utils.toast(`已清理 ${txns.length - validTxns.length} 条孤立记录`);
    this._verifyData();
  },

  _toggleAutoBackup() {
    const enabled = localStorage.getItem('autoBackup') === 'true';
    if (enabled) {
      localStorage.removeItem('autoBackup');
      Utils.toast('自动备份已关闭');
    } else {
      localStorage.setItem('autoBackup', 'true');
      Utils.toast('自动备份已开启（每日首次登录时执行）');
      // 立即执行一次
      this.exportData();
    }
  },

  /** 渲染用户列表 */
  async _renderUserList() {
    const wrap = document.getElementById('userManageWrap');
    if (!wrap) return;
    const users = await dbGetAll('users');
    if (!users.length) {
      wrap.innerHTML = '<div class="empty-state"><p>暂无用户</p></div>';
      return;
    }
    wrap.innerHTML = `<table>
      <tr><th>ID</th><th>用户名</th><th>显示名</th><th>角色</th><th>创建时间</th><th>操作</th></tr>
      ${users.map(u => `<tr>
        <td>${u.id}</td>
        <td><strong>${u.username}</strong></td>
        <td>${u.displayName || '-'}</td>
        <td><span class="tag ${u.role === 'admin' ? 'tag-in' : u.role === 'operator' ? 'tag-warn' : ''}">${Auth.roleName(u.role)}</span></td>
        <td class="text-muted">${Utils.fmtDate(u.createdAt)}</td>
        <td>
          <button class="btn btn-sm" onclick="Pages.showUserForm(${u.id})">✏️ 编辑</button>
          <button class="btn btn-sm btn-warning" onclick="Pages.resetUserPwd(${u.id})">🔑 重置密码</button>
          ${u.username !== 'admin' ? `<button class="btn btn-sm btn-danger" onclick="Pages.delUser(${u.id})">🗑️ 删除</button>` : ''}
        </td>
      </tr>`).join('')}
    </table>`;
  },

  async showUserForm(id) {
    const user = id ? await dbGetById('users', id) : {};
    const title = id ? '编辑用户' : '新增用户';
    const roleOpts = ['admin','operator','viewer'].map(r =>
      `<option value="${r}" ${user.role === r ? 'selected' : ''}>${Auth.roleName(r)}</option>`
    ).join('');
    const pwdField = id ? '' : `
      <div class="form-group"><label>密码 *</label><input class="form-control" id="uf_pwd" type="password" placeholder="设置密码"></div>`;
    const html = `
      <div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <input type="hidden" id="uf_id" value="${id || ''}">
      <div class="form-row">
        <div class="form-group"><label>用户名 *</label><input class="form-control" id="uf_user" value="${user.username || ''}" placeholder="登录用户名"></div>
        <div class="form-group"><label>显示名</label><input class="form-control" id="uf_name" value="${user.displayName || ''}" placeholder="显示名称"></div>
      </div>
      ${pwdField}
      <div class="form-group"><label>角色</label>
        <select class="form-control" id="uf_role">${roleOpts}</select>
        <div class="hint">管理员：全部权限 / 操作员：除系统设置外均可操作 / 只读用户：仅查看</div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="Pages.saveUser()">保存</button>
      </div>`;
    Utils.openModal(html);
  },

  async saveUser() {
    const id = document.getElementById('uf_id').value;
    const username = document.getElementById('uf_user').value.trim();
    const displayName = document.getElementById('uf_name').value.trim();
    const role = document.getElementById('uf_role').value;
    if (!username) return Utils.toast('请输入用户名', 'error');

    const existing = await dbGetAll('users');
    const dup = existing.find(u => u.username === username && u.id != (id || 0));
    if (dup) return Utils.toast('用户名已存在', 'error');

    if (id) {
      const user = await dbGetById('users', id);
      if (!user) return Utils.toast('用户不存在', 'error');
      if (user.username === 'admin' && role !== 'admin') {
        return Utils.toast('不能降低 admin 的权限', 'error');
      }
      user.username = username;
      user.displayName = displayName;
      user.role = role;
      user.updatedAt = Utils.now();
      await dbPut('users', user);
      Utils.toast('用户已更新');
    } else {
      const pwd = document.getElementById('uf_pwd').value.trim();
      if (!pwd) return Utils.toast('请设置密码', 'error');
      await dbAdd('users', {
        username, displayName, role,
        password: pwd,
        createdAt: Utils.now(), updatedAt: Utils.now()
      });
      Utils.toast('用户已创建');
    }
    Utils.closeModal();
    Pages.navigate('settings');
  },

  async delUser(id) {
    const user = await dbGetById('users', id);
    if (!user) return Utils.toast('用户不存在', 'error');
    if (user.username === 'admin') return Utils.toast('不能删除 admin 账号', 'error');
    const ok = await Utils.confirm(`确定删除用户 "${user.displayName || user.username}"？`);
    if (!ok) return;
    await dbDelete('users', id);
    Utils.toast('用户已删除');
    Pages.navigate('settings');
  },

  async resetUserPwd(id) {
    const user = await dbGetById('users', id);
    if (!user) return Utils.toast('用户不存在', 'error');
    const html = `
      <div class="modal-header"><h3>🔑 重置密码</h3><button class="modal-close" onclick="Utils.closeModal()">&times;</button></div>
      <p class="mb-16">为用户 <strong>${user.displayName || user.username}</strong> 重置密码</p>
      <div class="form-group"><label>新密码 *</label><input class="form-control" id="rp_pwd" type="password" placeholder="输入新密码"></div>
      <div class="modal-footer">
        <button class="btn" onclick="Utils.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="Pages.doResetPwd(${id})">确认重置</button>
      </div>`;
    Utils.openModal(html);
  },

  async doResetPwd(id) {
    const pwd = document.getElementById('rp_pwd').value.trim();
    if (!pwd || pwd.length < 3) return Utils.toast('密码至少3位', 'error');
    const user = await dbGetById('users', id);
    if (!user) return Utils.toast('用户不存在', 'error');
    user.password = pwd;
    user.updatedAt = Utils.now();
    await dbPut('users', user);
    Utils.toast('密码已重置');
    Utils.closeModal();
  },
};

// =============================================================
// 启动
// =============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化认证模块（首次运行自动创建默认管理员账号）
  await Auth.init();

  // 导航点击
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => Pages.navigate(el.dataset.page));
  });

  // 模态框外点击关闭
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) Utils.closeModal();
  });

  // 更新侧边栏用户状态
  updateSidebarUser();

  // 自动备份检查
  if (localStorage.getItem('autoBackup') === 'true') {
    const lastBackup = localStorage.getItem('lastBackupDate');
    const today = new Date().toLocaleDateString();
    if (lastBackup !== today) {
      localStorage.setItem('lastBackupDate', today);
      // 延迟执行，避免影响启动速度
      setTimeout(() => Pages.exportData(), 3000);
    }
  }
});
