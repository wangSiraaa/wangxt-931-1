const API_BASE = '';
let editingFamilyId = null;
let currentReviewVisitId = null;
let threshold = 800;

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadThreshold();
  refreshAll();
  setDefaultOperator();
});

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      switchPage(page);
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tab === 'pending' ? 'pendingReviews' : 'reviewHistory').classList.add('active');
    });
  });

  document.getElementById('btnAddFamily').addEventListener('click', () => openFamilyModal());
  document.getElementById('btnAddVisit').addEventListener('click', () => openVisitModal());
  document.getElementById('btnAddSubsidy').addEventListener('click', () => openSubsidyModal());
  document.getElementById('btnAddRestoration').addEventListener('click', () => openRestorationModal());
}

function setDefaultOperator() {
  const roleMap = { civil: '民政专员A', grid: '网格员A', reviewer: '审核员A' };
  const role = document.getElementById('roleSelect').value;
  if (!document.getElementById('operatorName').value) {
    document.getElementById('operatorName').value = roleMap[role];
  }
  document.getElementById('roleSelect').addEventListener('change', () => {
    document.getElementById('operatorName').value = roleMap[document.getElementById('roleSelect').value];
  });
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.classList.remove('show'), 2800);
}

async function api(url, options = {}) {
  try {
    const res = await fetch(API_BASE + url, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  } catch (e) {
    showToast(e.message, 'error');
    throw e;
  }
}

async function loadThreshold() {
  try {
    const data = await api('/api/config');
    threshold = data.income_threshold;
    document.getElementById('thresholdValue').textContent = threshold;
  } catch (e) {}
}

function refreshAll() {
  loadFamilies();
  loadVisits();
  loadPendingReviews();
  loadReviewHistory();
  loadSubsidies();
  loadRestorations();
}

// ==================== 家庭档案 ====================

async function loadFamilies() {
  try {
    const families = await api('/api/families');
    const container = document.getElementById('familyList');
    if (families.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>暂无家庭档案</p></div>';
      return;
    }
    container.innerHTML = families.map(f => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${f.head_name}（${f.family_code}）
              <span class="status-tag status-${f.subsidy_status}">${getStatusText(f.subsidy_status)}</span>
            </div>
            <div class="card-subtitle">📍 ${f.address} | 👥 ${f.member_count}人</div>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm btn-secondary" onclick="viewFamily(${f.id})">查看</button>
            <button class="btn btn-sm btn-secondary" onclick="openFamilyModal(${f.id})">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deleteFamily(${f.id})">删除</button>
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">收入来源：</span><span class="value">${f.income_source}</span></div>
          <div class="info-item"><span class="label">上次复核：</span><span class="value">${f.last_review_conclusion || '暂无'}</span></div>
          <div class="info-item"><span class="label">建档人：</span><span class="value">${f.created_by}</span></div>
          <div class="info-item"><span class="label">建档时间：</span><span class="value">${f.created_at}</span></div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function viewFamily(id) {
  try {
    const f = await api('/api/families/' + id);
    alert(`
家庭档案详情
================
编号：${f.family_code}
户主：${f.head_name}
地址：${f.address}
收入来源：${f.income_source}
家庭月收入：${f.total_income} 元（阈值：${threshold}元）
状态：${getStatusText(f.subsidy_status)}
上次复核：${f.last_review_conclusion || '暂无'}
建档人：${f.created_by}
建档时间：${f.created_at}

家庭成员：
${f.members.map(m => `  · ${m.name}（${m.relation}）- ${m.income}元/月 - ${m.employment_status || '无'}${m.age ? ' - ' + m.age + '岁' : ''}`).join('\n')}
    `);
  } catch (e) {}
}

async function openFamilyModal(id) {
  editingFamilyId = id || null;
  document.getElementById('familyModalTitle').textContent = id ? '编辑家庭档案' : '新建家庭档案';
  document.getElementById('familyForm').reset();
  document.getElementById('membersList').innerHTML = '';
  document.getElementById('familyCreatedBy').value = document.getElementById('operatorName').value;

  if (id) {
    try {
      const f = await api('/api/families/' + id);
      const form = document.getElementById('familyForm');
      form.family_code.value = f.family_code;
      form.head_name.value = f.head_name;
      form.address.value = f.address;
      form.income_source.value = f.income_source;
      form.last_review_conclusion.value = f.last_review_conclusion || '';
      form.created_by.value = f.created_by;
      f.members.forEach(m => addMemberRow(m));
    } catch (e) { return; }
  } else {
    addMemberRow({ relation: '户主' });
  }
  document.getElementById('familyModal').classList.add('active');
}

function addMemberRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'member-row';
  row.innerHTML = `
    <input type="text" name="name" placeholder="姓名*" value="${data.name || ''}">
    <input type="text" name="relation" placeholder="关系*" value="${data.relation || ''}">
    <input type="number" name="age" placeholder="年龄" value="${data.age || ''}">
    <input type="number" name="income" placeholder="月收入" value="${data.income || 0}" step="any">
    <input type="text" name="employment_status" placeholder="就业状态" value="${data.employment_status || ''}">
    <button type="button" class="remove-member" onclick="this.parentElement.remove()">×</button>
  `;
  document.getElementById('membersList').appendChild(row);
}

async function saveFamily() {
  const form = document.getElementById('familyForm');
  const memberRows = document.querySelectorAll('#membersList .member-row');
  const members = Array.from(memberRows).map(row => ({
    name: row.querySelector('[name=name]').value,
    relation: row.querySelector('[name=relation]').value,
    age: row.querySelector('[name=age]').value,
    income: row.querySelector('[name=income]').value,
    employment_status: row.querySelector('[name=employment_status]').value
  }));

  const data = {
    family_code: form.family_code.value,
    head_name: form.head_name.value,
    address: form.address.value,
    income_source: form.income_source.value,
    last_review_conclusion: form.last_review_conclusion.value,
    created_by: form.created_by.value,
    members
  };

  try {
    if (editingFamilyId) {
      await api('/api/families/' + editingFamilyId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      showToast('家庭档案已更新');
    } else {
      await api('/api/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      showToast('家庭档案创建成功');
    }
    closeModal('familyModal');
    loadFamilies();
  } catch (e) {}
}

async function deleteFamily(id) {
  if (!confirm('确认删除该家庭档案？')) return;
  try {
    await api('/api/families/' + id, { method: 'DELETE' });
    showToast('已删除');
    loadFamilies();
  } catch (e) {}
}

// ==================== 走访记录 ====================

async function loadVisits() {
  try {
    const visits = await api('/api/visits');
    const container = document.getElementById('visitList');
    if (visits.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🚶</div><p>暂无走访记录</p></div>';
      return;
    }
    container.innerHTML = visits.map(v => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${v.head_name}（${v.family_code}）
              <span class="status-tag status-${v.status}">${v.status === 'submitted' ? '待审核' : v.status === 'reviewed' ? '已审核' : v.status}</span>
            </div>
            <div class="card-subtitle">📍 ${v.address}</div>
          </div>
          <div class="card-actions">
            ${v.status === 'submitted' ? '<button class="btn btn-sm btn-primary" onclick="switchPage(\'reviews\'); document.querySelector(\'.nav-btn[data-page=reviews]\').click()">去审核</button>' : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">走访人：</span><span class="value">${v.visitor_name}</span></div>
          <div class="info-item"><span class="label">走访日期：</span><span class="value">${v.visit_date}</span></div>
          <div class="info-item"><span class="label">走访地点：</span><span class="value">${v.location || '未填写'}</span></div>
          <div class="info-item"><span class="label">收入变化：</span><span class="value">${v.income_change > 0 ? '+' : ''}${v.income_change} 元</span></div>
          <div class="info-item" style="grid-column: 1 / -1;"><span class="label">备注：</span><span class="value">${v.notes || '无'}</span></div>
          <div class="info-item" style="grid-column: 1 / -1;">
            <span class="label">走访照片：</span>
            ${v.photo_path ? `<img src="/uploads/${v.photo_path}" class="photo-thumbnail">` : '<span class="status-tag status-cancelled">❌ 未上传</span>'}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function openVisitModal() {
  document.getElementById('visitForm').reset();
  document.getElementById('visitAlert').style.display = 'none';
  document.getElementById('visitVisitor').value = document.getElementById('operatorName').value;
  document.querySelector('#visitForm input[name=visit_date]').value = new Date().toISOString().split('T')[0];

  try {
    const families = await api('/api/families');
    const select = document.getElementById('visitFamilyId');
    select.innerHTML = '<option value="">请选择家庭</option>' +
      families.map(f => `<option value="${f.id}">${f.family_code} - ${f.head_name} [${getStatusText(f.subsidy_status)}]</option>`).join('');
  } catch (e) { return; }

  document.getElementById('visitModal').classList.add('active');
}

async function saveVisit() {
  const form = document.getElementById('visitForm');
  const alertEl = document.getElementById('visitAlert');
  const photoFile = document.getElementById('visitPhoto').files[0];

  if (!photoFile) {
    alertEl.textContent = '⚠️ 提示：走访照片未上传，建议上传照片后提交。系统将记录此次提交未附带照片。';
    alertEl.style.display = 'block';
    if (!confirm('走访照片未上传，是否仍要提交？')) return;
  }

  const fd = new FormData();
  fd.append('family_id', form.family_id.value);
  fd.append('visitor_name', form.visitor_name.value);
  fd.append('visit_date', form.visit_date.value);
  fd.append('location', form.location.value || '');
  fd.append('location_lat', form.location_lat.value || '');
  fd.append('location_lng', form.location_lng.value || '');
  fd.append('income_change', form.income_change.value || 0);
  fd.append('notes', form.notes.value || '');
  if (photoFile) fd.append('photo', photoFile);

  try {
    await api('/api/visits', { method: 'POST', body: fd });
    showToast('走访记录已提交');
    closeModal('visitModal');
    loadVisits();
    loadPendingReviews();
  } catch (e) {}
}

// ==================== 审核 ====================

async function loadPendingReviews() {
  try {
    const reviews = await api('/api/reviews/pending');
    const container = document.getElementById('pendingReviews');
    if (reviews.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>暂无待审核记录</p></div>';
      return;
    }
    container.innerHTML = reviews.map(v => {
      const overThreshold = v.total_income > threshold;
      return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${v.head_name}（${v.family_code}）
              <span class="status-tag status-submitted">待审核</span>
            </div>
            <div class="card-subtitle">走访日期：${v.visit_date} | 走访人：${v.visitor_name}</div>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm btn-primary" onclick="openReviewModal(${v.id})">审核</button>
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">家庭月收入：</span><span class="value">${v.total_income} 元</span></div>
          <div class="info-item"><span class="label">收入变化：</span><span class="value">${v.income_change > 0 ? '+' : ''}${v.income_change} 元</span></div>
          <div class="info-item"><span class="label">阈值：</span><span class="value">${threshold} 元</span></div>
          <div class="info-item">
            <span class="label">照片：</span>
            <span class="value">${v.photo_path ? '✅ 已上传' : '❌ 未上传'}</span>
          </div>
          <div class="info-highlight ${overThreshold ? '' : 'threshold-ok'}">
            ${overThreshold ? '⚠️ 收入超过阈值（' + v.total_income + ' > ' + threshold + '），不能直接发放，需进入复核并冻结本期补贴' : '✅ 收入在阈值以内（' + v.total_income + ' ≤ ' + threshold + '），可正常发放'}
          </div>
          ${v.notes ? `<div class="info-item" style="grid-column:1/-1;"><span class="label">走访备注：</span><span class="value">${v.notes}</span></div>` : ''}
        </div>
      </div>
    `}).join('');
  } catch (e) {}
}

async function loadReviewHistory() {
  try {
    const reviews = await api('/api/reviews');
    const container = document.getElementById('reviewHistory');
    if (reviews.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📝</div><p>暂无审核记录</p></div>';
      return;
    }
    container.innerHTML = reviews.map(r => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${r.head_name}（${r.family_code}）
              <span class="status-tag status-${r.decision}">${getDecisionText(r.decision)}</span>
            </div>
            <div class="card-subtitle">审核人：${r.reviewer_name} | ${r.created_at}</div>
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">走访日期：</span><span class="value">${r.visit_date}</span></div>
          <div class="info-item"><span class="label">适用阈值：</span><span class="value">${r.threshold_applied} 元</span></div>
          <div class="info-item" style="grid-column:1/-1;"><span class="label">审核说明：</span><span class="value">${r.reason || '无'}</span></div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function openReviewModal(visitId) {
  currentReviewVisitId = visitId;
  document.getElementById('reviewForm').reset();
  try {
    const visit = await api('/api/visits/' + visitId);
    const family = await api('/api/families/' + visit.family_id);
    const overThreshold = family.total_income > threshold;
    document.getElementById('reviewFamilyInfo').innerHTML = `
      <h4>家庭信息</h4>
      <div class="info-grid">
        <div><strong>${family.head_name}</strong>（${family.family_code}）</div>
        <div>状态：<span class="status-tag status-${family.subsidy_status}">${getStatusText(family.subsidy_status)}</span></div>
        <div>月收入：${family.total_income} 元</div>
        <div>阈值：${threshold} 元</div>
      </div>
      <div class="info-highlight ${overThreshold ? '' : 'threshold-ok'}">
        ${overThreshold ? '⚠️ 收入超过阈值，选择"继续发放"将自动进入复核并冻结本期补贴' : '✅ 收入正常，可正常发放'}
      </div>
      <div style="margin-top:10px; font-size:13px; color:#666;">
        走访人：${visit.visitor_name} | 日期：${visit.visit_date}
        ${visit.location ? ' | 地点：' + visit.location : ''}
        ${visit.income_change ? ' | 收入变化：' + (visit.income_change > 0 ? '+' : '') + visit.income_change + '元' : ''}
        <br>照片：${visit.photo_path ? '✅ 已上传' : '❌ 未上传'}
        ${visit.notes ? '<br>备注：' + visit.notes : ''}
      </div>
    `;
  } catch (e) { return; }
  document.getElementById('reviewModal').classList.add('active');
}

async function submitReview() {
  const form = document.getElementById('reviewForm');
  if (!form.decision.value) {
    showToast('请选择审核决定', 'error');
    return;
  }
  try {
    await api('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visit_id: currentReviewVisitId,
        reviewer_name: document.getElementById('operatorName').value,
        decision: form.decision.value,
        reason: form.reason.value
      })
    });
    showToast('审核完成');
    closeModal('reviewModal');
    loadPendingReviews();
    loadReviewHistory();
    loadFamilies();
    loadSubsidies();
  } catch (e) {}
}

// ==================== 补贴发放 ====================

async function loadSubsidies() {
  try {
    const subsidies = await api('/api/subsidies');
    const container = document.getElementById('subsidyList');
    if (subsidies.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">💰</div><p>暂无补贴记录</p></div>';
      return;
    }
    container.innerHTML = subsidies.map(s => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${s.head_name}（${s.family_code}）
              <span class="status-tag status-${s.status}">${getSubsidyStatus(s.status)}</span>
            </div>
            <div class="card-subtitle">补贴期间：${s.period}</div>
          </div>
          <div class="card-actions">
            ${(s.status === 'pending' || s.status === 'frozen') ?
              `<button class="btn btn-sm btn-success" onclick="releaseSubsidy(${s.id})">发放</button>` : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">补贴金额：</span><span class="value" style="color:#fa8c16; font-size:18px; font-weight:600;">¥ ${s.amount.toFixed(2)}</span></div>
          <div class="info-item"><span class="label">家庭状态：</span><span class="value"><span class="status-tag status-${s.family_status}">${getStatusText(s.family_status)}</span></span></div>
          <div class="info-item"><span class="label">生成时间：</span><span class="value">${s.created_at}</span></div>
          ${s.frozen_reason ? `<div class="info-item" style="grid-column:1/-1;"><span class="label">冻结原因：</span><span class="value" style="color:#ff4d4f;">${s.frozen_reason}</span></div>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function openSubsidyModal() {
  document.getElementById('subsidyForm').reset();
  document.getElementById('subsidyAlert').style.display = 'none';
  document.querySelector('#subsidyForm input[name=period]').value = new Date().toISOString().slice(0, 7);

  try {
    const families = await api('/api/families');
    const select = document.getElementById('subsidyFamilyId');
    select.innerHTML = '<option value="">请选择家庭</option>' +
      families.map(f => `<option value="${f.id}">${f.family_code} - ${f.head_name} [${getStatusText(f.subsidy_status)}]${f.subsidy_status === 'cancelled' ? ' ⚠️已取消' : ''}</option>`).join('');
  } catch (e) { return; }

  document.getElementById('subsidyModal').classList.add('active');
}

async function saveSubsidy() {
  const form = document.getElementById('subsidyForm');
  try {
    const res = await api('/api/subsidies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_id: form.family_id.value,
        period: form.period.value,
        amount: parseFloat(form.amount.value)
      })
    });
    showToast(res.message + (res.status !== 'pending' ? '（状态：' + getSubsidyStatus(res.status) + '）' : ''), res.status === 'frozen' || res.status === 'suspended' ? 'info' : 'success');
    closeModal('subsidyModal');
    loadSubsidies();
  } catch (e) {
    document.getElementById('subsidyAlert').textContent = '❌ ' + e.message;
    document.getElementById('subsidyAlert').style.display = 'block';
    document.getElementById('subsidyAlert').className = 'alert alert-error';
  }
}

async function releaseSubsidy(id) {
  if (!confirm('确认发放该笔补贴？')) return;
  try {
    await api('/api/subsidies/' + id + '/release', { method: 'PUT' });
    showToast('补贴已发放');
    loadSubsidies();
  } catch (e) {}
}

// ==================== 资格恢复 ====================

async function loadRestorations() {
  try {
    const records = await api('/api/restorations');
    const container = document.getElementById('restorationList');
    if (records.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🔄</div><p>暂无资格恢复申请</p></div>';
      return;
    }
    container.innerHTML = records.map(r => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${r.head_name}（${r.family_code}）
              <span class="status-tag status-${r.status}">${r.status === 'pending' ? '待审核' : r.status === 'approved' ? '已通过' : '已拒绝'}</span>
            </div>
            <div class="card-subtitle">申请人：${r.applicant_name} | ${r.created_at}</div>
          </div>
          <div class="card-actions">
            ${r.status === 'pending' ? `
              <button class="btn btn-sm btn-success" onclick="reviewRestoration(${r.id}, true)">通过</button>
              <button class="btn btn-sm btn-danger" onclick="reviewRestoration(${r.id}, false)">拒绝</button>
            ` : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="info-item" style="grid-column:1/-1;"><span class="label">申请理由：</span><span class="value">${r.reason}</span></div>
          ${r.reviewer_name ? `<div class="info-item"><span class="label">审核人：</span><span class="value">${r.reviewer_name}</span></div>` : ''}
          ${r.review_reason ? `<div class="info-item"><span class="label">审核说明：</span><span class="value">${r.review_reason}</span></div>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function openRestorationModal() {
  document.getElementById('restorationForm').reset();
  try {
    const families = await api('/api/families');
    const cancelled = families.filter(f => f.subsidy_status === 'cancelled');
    const select = document.getElementById('restorationFamilyId');
    select.innerHTML = '<option value="">请选择家庭</option>' +
      cancelled.map(f => `<option value="${f.id}">${f.family_code} - ${f.head_name}</option>`).join('');
    if (cancelled.length === 0) {
      showToast('当前没有已取消资格的家庭', 'info');
    }
  } catch (e) { return; }
  document.getElementById('restorationModal').classList.add('active');
}

async function saveRestoration() {
  const form = document.getElementById('restorationForm');
  try {
    await api('/api/restorations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_id: form.family_id.value,
        applicant_name: form.applicant_name.value,
        reason: form.reason.value
      })
    });
    showToast('申请已提交');
    closeModal('restorationModal');
    loadRestorations();
  } catch (e) {}
}

async function reviewRestoration(id, approved) {
  const reason = prompt(approved ? '请输入通过说明（可选）：' : '请输入拒绝理由：');
  try {
    await api('/api/restorations/' + id + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: document.getElementById('operatorName').value,
        approved,
        reason: reason || ''
      })
    });
    showToast(approved ? '资格恢复通过' : '已拒绝');
    loadRestorations();
    loadFamilies();
  } catch (e) {}
}

// ==================== 工具函数 ====================

function getStatusText(s) {
  const map = { active: '正常', suspended: '暂停', cancelled: '已取消', review: '复核中' };
  return map[s] || s;
}

function getDecisionText(d) {
  const map = { 'continue': '继续发放', 'suspend': '暂停发放', 'cancel': '取消资格' };
  return map[d] || d;
}

function getSubsidyStatus(s) {
  const map = { pending: '待发放', frozen: '已冻结', released: '已发放', suspended: '已暂停' };
  return map[s] || s;
}
