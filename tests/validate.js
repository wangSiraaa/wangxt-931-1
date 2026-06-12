#!/usr/bin/env node

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;
let results = [];

async function request(path, options = {}) {
  const fullUrl = BASE_URL + path;
  const opts = { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } };
  if (options.body && opts.headers['Content-Type'] === 'application/json') {
    opts.body = JSON.stringify(options.body);
  }
  opts.method = options.method || 'GET';
  if (options.formData) {
    delete opts.headers['Content-Type'];
    const fd = options.formData;
    if (fd.getHeaders) {
      opts.headers = { ...opts.headers, ...fd.getHeaders() };
    }
    if (fd.toBuffer) {
      opts.body = fd.toBuffer();
    } else if (fd.pipe) {
      opts.body = await new Promise((resolve, reject) => {
        const chunks = [];
        fd.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        fd.on('end', () => resolve(Buffer.concat(chunks)));
        fd.on('error', reject);
        fd.resume();
      });
    } else {
      opts.body = fd;
    }
  }
  const res = await fetch(fullUrl, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function test(name, fn) {
  return async function() {
    try {
      await fn();
      passed++;
      results.push({ name, status: '✅ PASS', detail: '' });
      console.log('✅  PASS:', name);
    } catch (e) {
      failed++;
      results.push({ name, status: '❌ FAIL', detail: e.message });
      console.log('❌  FAIL:', name, '-', e.message);
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message || `期望 ${expected}，实际 ${actual}`);
}

async function getVisitCount() {
  const res = await request('/api/visits');
  assert(res.ok, '获取走访列表失败');
  return res.data.length;
}

async function getSubmittedVisitCount() {
  const res = await request('/api/visits');
  assert(res.ok, '获取走访列表失败');
  return res.data.filter(v => v.status === 'submitted').length;
}

function makePhotoBuffer() {
  const FormData = require('form-data');
  const fd = new FormData();
  const buf = Buffer.from('fake-image-content-for-testing');
  fd.append('photo', buf, { filename: 'test-photo.jpg', contentType: 'image/jpeg' });
  return fd;
}

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  低保走访核查系统 - 回归验证测试');
  console.log('  API地址:', BASE_URL);
  console.log('='.repeat(60) + '\n');

  await test('服务健康检查 - GET /api/config 返回阈值配置', async () => {
    const res = await request('/api/config');
    assert(res.ok, '请求失败');
    assert(typeof res.data.income_threshold === 'number', '未返回阈值配置');
    console.log('       当前收入阈值:', res.data.income_threshold, '元/月');
  })();

  await test('获取家庭档案列表', async () => {
    const res = await request('/api/families');
    assert(res.ok, '请求失败');
    assert(Array.isArray(res.data), '返回数据不是数组');
    assert(res.data.length > 0, '家庭档案列表为空');
    console.log('       已存在家庭档案数量:', res.data.length);
  })();

  let normalFamilyId = null;
  await test('民政专员 - 新建完整家庭档案（含成员）', async () => {
    const res = await request('/api/families', {
      method: 'POST',
      body: {
        family_code: 'REG-' + Date.now().toString().slice(-6),
        head_name: '回归测试户主',
        address: '回归测试社区1号楼101',
        income_source: '打零工',
        last_review_conclusion: '初始建档',
        created_by: '民政专员A',
        members: [
          { name: '回归测试户主', relation: '户主', age: 45, income: 300, employment_status: '灵活就业' },
          { name: '回归测试配偶', relation: '配偶', age: 43, income: 200, employment_status: '待业' },
          { name: '回归测试子女', relation: '子女', age: 10, income: 0, employment_status: '学生' }
        ]
      }
    });
    assert(res.ok, '创建失败: ' + (res.data.error || ''));
    assert(res.data.id, '未返回家庭ID');
    normalFamilyId = res.data.id;
    console.log('       新建家庭ID:', normalFamilyId);
  })();

  await test('查询家庭档案详情（含成员和总收入）', async () => {
    assert(normalFamilyId, '需要先创建家庭档案');
    const res = await request('/api/families/' + normalFamilyId);
    assert(res.ok, '查询失败');
    assertEqual(res.data.members.length, 3, '家庭成员数量不符');
    assertEqual(res.data.total_income, 500, '家庭总收入计算错误');
    console.log('       家庭月总收入:', res.data.total_income, '元');
  })();

  // ======== 三类校验：照片缺失、日期早于建档、信息不完整 ========

  await test('校验1 - 走访照片缺失：POST /api/visits 返回400且不写入记录', async () => {
    assert(normalFamilyId, '需要先创建家庭档案');
    const FormData = require('form-data');
    const fd = new FormData();
    fd.append('family_id', normalFamilyId);
    fd.append('visitor_name', '网格员A');
    fd.append('visit_date', new Date().toISOString().split('T')[0]);
    fd.append('notes', '测试无照片走访');

    const beforeCount = await getVisitCount();
    const res = await request('/api/visits', { method: 'POST', formData: fd });
    const afterCount = await getVisitCount();

    assertEqual(res.status, 400, '照片缺失应返回400状态码');
    assert(res.data.error && res.data.error.includes('照片'), '错误信息应包含照片: ' + (res.data.error || ''));
    assertEqual(afterCount, beforeCount, '照片缺失时不应写入visits记录');
    console.log('       服务器正确拒绝:', res.data.error);
    console.log('       走访记录数: 提交前', beforeCount, '→ 提交后', afterCount, '(无变化)');
  })();

  await test('校验1续 - 照片缺失时不生成待审核走访', async () => {
    const pendingBefore = await getSubmittedVisitCount();
    const FormData = require('form-data');
    const fd = new FormData();
    fd.append('family_id', normalFamilyId);
    fd.append('visitor_name', '网格员A');
    fd.append('visit_date', new Date().toISOString().split('T')[0]);

    await request('/api/visits', { method: 'POST', formData: fd });
    const pendingAfter = await getSubmittedVisitCount();
    assertEqual(pendingAfter, pendingBefore, '照片缺失不应产生新的待审核走访');
    console.log('       待审核走访数: 提交前', pendingBefore, '→ 提交后', pendingAfter, '(无变化)');
  })();

  await test('校验2 - 走访日期早于建档日期：POST /api/visits 返回400且不写入记录', async () => {
    assert(normalFamilyId, '需要先创建家庭档案');
    const fd = makePhotoBuffer();
    fd.append('family_id', normalFamilyId);
    fd.append('visitor_name', '网格员A');
    fd.append('visit_date', '2020-01-01');
    fd.append('notes', '测试日期早于建档');

    const beforeCount = await getVisitCount();
    const res = await request('/api/visits', { method: 'POST', formData: fd });
    const afterCount = await getVisitCount();

    assertEqual(res.status, 400, '日期早于建档应返回400状态码');
    assert(res.data.error && res.data.error.includes('早于建档日期'), '错误信息不符: ' + (res.data.error || ''));
    assertEqual(afterCount, beforeCount, '日期早于建档时不应写入visits记录');
    console.log('       服务器正确拒绝:', res.data.error);
    console.log('       走访记录数: 提交前', beforeCount, '→ 提交后', afterCount, '(无变化)');
  })();

  await test('校验2续 - 日期早于建档时不生成待审核走访', async () => {
    const pendingBefore = await getSubmittedVisitCount();
    const fd = makePhotoBuffer();
    fd.append('family_id', normalFamilyId);
    fd.append('visitor_name', '网格员A');
    fd.append('visit_date', '2020-01-01');

    await request('/api/visits', { method: 'POST', formData: fd });
    const pendingAfter = await getSubmittedVisitCount();
    assertEqual(pendingAfter, pendingBefore, '日期早于建档不应产生新的待审核走访');
    console.log('       待审核走访数: 提交前', pendingBefore, '→ 提交后', pendingAfter, '(无变化)');
  })();

  let incompleteFamilyId = null;
  await test('创建不完整家庭（head_name置空）以模拟信息不完整', async () => {
    const code = 'INC-' + Date.now().toString().slice(-6);
    const res = await request('/api/families', {
      method: 'POST',
      body: {
        family_code: code,
        head_name: '临时户主',
        address: '测试社区2号楼',
        income_source: '无',
        created_by: '民政专员A',
        members: [{ name: '临时成员', relation: '户主', income: 0 }]
      }
    });
    assert(res.ok, '创建临时家庭失败: ' + (res.data.error || ''));
    incompleteFamilyId = res.data.id;
    const updateRes = await request('/api/families/' + incompleteFamilyId, {
      method: 'PUT',
      body: {
        head_name: '',
        address: '测试社区2号楼',
        income_source: '无',
        subsidy_status: 'active',
        last_review_conclusion: '测试用',
        members: [{ name: '临时成员', relation: '户主', income: 0 }]
      }
    });
    assert(updateRes.ok, '置空字段失败');
    console.log('       不完整家庭ID:', incompleteFamilyId);
  })();

  await test('校验3 - 家庭成员信息不完整：POST /api/visits 返回400且不写入记录', async () => {
    assert(incompleteFamilyId, '需要先创建不完整家庭');
    const fd = makePhotoBuffer();
    fd.append('family_id', incompleteFamilyId);
    fd.append('visitor_name', '网格员A');
    fd.append('visit_date', new Date().toISOString().split('T')[0]);

    const beforeCount = await getVisitCount();
    const res = await request('/api/visits', { method: 'POST', formData: fd });
    const afterCount = await getVisitCount();

    assertEqual(res.status, 400, '信息不完整应返回400状态码');
    assert(res.data.error && res.data.error.includes('信息不完整'), '错误信息不符: ' + (res.data.error || ''));
    assertEqual(afterCount, beforeCount, '信息不完整时不应写入visits记录');
    console.log('       服务器正确拒绝:', res.data.error);
    console.log('       走访记录数: 提交前', beforeCount, '→ 提交后', afterCount, '(无变化)');
  })();

  await test('校验3续 - 信息不完整时不生成待审核走访', async () => {
    const pendingBefore = await getSubmittedVisitCount();
    const fd = makePhotoBuffer();
    fd.append('family_id', incompleteFamilyId);
    fd.append('visitor_name', '网格员A');
    fd.append('visit_date', new Date().toISOString().split('T')[0]);

    await request('/api/visits', { method: 'POST', formData: fd });
    const pendingAfter = await getSubmittedVisitCount();
    assertEqual(pendingAfter, pendingBefore, '信息不完整不应产生新的待审核走访');
    console.log('       待审核走访数: 提交前', pendingBefore, '→ 提交后', pendingAfter, '(无变化)');
  })();

  // ======== 正常走访提交（有照片、日期合规、信息完整） ========

  let normalVisitId = null;
  await test('正常走访提交：有照片+合规日期+完整信息，应成功', async () => {
    assert(normalFamilyId, '需要先创建家庭档案');
    const fd = makePhotoBuffer();
    fd.append('family_id', normalFamilyId);
    fd.append('visitor_name', '网格员A');
    fd.append('visit_date', new Date().toISOString().split('T')[0]);
    fd.append('income_change', '0');
    fd.append('notes', '正常走访');

    const beforeCount = await getVisitCount();
    const res = await request('/api/visits', { method: 'POST', formData: fd });
    const afterCount = await getVisitCount();

    assert(res.ok, '正常走访提交失败: ' + (res.data.error || ''));
    assert(res.data.id, '未返回走访ID');
    assertEqual(afterCount, beforeCount + 1, '正常走访应写入visits记录');
    normalVisitId = res.data.id;
    console.log('       走访记录ID:', normalVisitId);
    console.log('       走访记录数: 提交前', beforeCount, '→ 提交后', afterCount, '(+1)');
  })();

  await test('正常走访提交后生成待审核走访', async () => {
    const visit = await request('/api/visits/' + normalVisitId);
    assert(visit.ok, '查询走访记录失败');
    assertEqual(visit.data.status, 'submitted', '正常走访状态应为submitted');
    console.log('       走访状态:', visit.data.status, '(待审核)');
  })();

  // ======== 高收入超阈值复核 ========

  let highIncomeFamilyId = null;
  await test('创建高收入家庭（用于超阈值测试）', async () => {
    const res = await request('/api/families', {
      method: 'POST',
      body: {
        family_code: 'HIGH-' + Date.now().toString().slice(-6),
        head_name: '高收入家庭',
        address: '富裕社区8号楼',
        income_source: '工资收入',
        created_by: '民政专员A',
        members: [
          { name: '高收入户主', relation: '户主', age: 40, income: 3000, employment_status: '在职' },
          { name: '高收入配偶', relation: '配偶', age: 38, income: 2500, employment_status: '在职' }
        ]
      }
    });
    assert(res.ok, '创建高收入家庭失败');
    highIncomeFamilyId = res.data.id;
    console.log('       高收入家庭ID:', highIncomeFamilyId);
  })();

  let highIncomeVisitId = null;
  await test('为高收入家庭提交走访记录（有照片）', async () => {
    assert(highIncomeFamilyId);
    const fd = makePhotoBuffer();
    fd.append('family_id', highIncomeFamilyId);
    fd.append('visitor_name', '网格员A');
    fd.append('visit_date', new Date().toISOString().split('T')[0]);
    fd.append('notes', '高收入家庭走访');
    fd.append('income_change', '0');

    const res = await request('/api/visits', { method: 'POST', formData: fd });
    assert(res.ok, '走访提交失败: ' + (res.data.error || ''));
    highIncomeVisitId = res.data.id;
    console.log('       高收入走访ID:', highIncomeVisitId);
  })();

  await test('审核员 - 收入超过阈值，"继续发放"应进入复核并冻结补贴', async () => {
    assert(highIncomeVisitId, '需要走访记录');
    const cfg = await request('/api/config');
    const threshold = cfg.data.income_threshold;
    console.log('       阈值:', threshold, '元，家庭收入5500元');

    const res = await request('/api/reviews', {
      method: 'POST',
      body: {
        visit_id: highIncomeVisitId,
        reviewer_name: '审核员A',
        decision: 'continue',
        reason: '收入超过阈值，自动复核'
      }
    });
    assert(res.ok, '审核失败: ' + (res.data.error || ''));

    const family = await request('/api/families/' + highIncomeFamilyId);
    assertEqual(family.data.subsidy_status, 'review', '家庭状态应为"复核中"');
    console.log('       家庭状态:', family.data.subsidy_status, '(应为: review)');

    const period = new Date().toISOString().slice(0, 7);
    const subsidies = await request('/api/subsidies');
    const frozen = subsidies.data.find(s => s.family_id == highIncomeFamilyId && s.period === period);
    assert(frozen, '应生成冻结状态的补贴记录');
    assertEqual(frozen.status, 'frozen', '补贴状态应为frozen');
    assert(frozen.frozen_reason && frozen.frozen_reason.includes('阈值'), '冻结原因应包含阈值');
    console.log('       补贴状态:', frozen.status, '，冻结原因:', frozen.frozen_reason);
  })();

  // ======== 已取消资格家庭 ========

  let cancelledFamilyId = null;
  await test('查找或创建已取消资格家庭', async () => {
    const list = await request('/api/families');
    const cancelled = list.data.find(f => f.subsidy_status === 'cancelled');
    if (cancelled) {
      cancelledFamilyId = cancelled.id;
      console.log('       使用已有已取消家庭:', cancelled.head_name);
    } else {
      const res = await request('/api/families', {
        method: 'POST',
        body: {
          family_code: 'CANC-' + Date.now().toString().slice(-6),
          head_name: '已取消家庭',
          address: '测试社区',
          income_source: '工资',
          created_by: '民政专员A',
          members: [{ name: '户主', relation: '户主', income: 5000 }]
        }
      });
      cancelledFamilyId = res.data.id;
      await request('/api/families/' + cancelledFamilyId, {
        method: 'PUT',
        body: {
          head_name: '已取消家庭', address: '测试社区', income_source: '工资',
          subsidy_status: 'cancelled', last_review_conclusion: '测试取消',
          members: [{ name: '户主', relation: '户主', income: 5000 }]
        }
      });
    }
  })();

  await test('已取消资格的家庭不能生成补贴', async () => {
    assert(cancelledFamilyId, '需要已取消资格家庭');
    const period = new Date().toISOString().slice(0, 7);
    const res = await request('/api/subsidies', {
      method: 'POST',
      body: {
        family_id: cancelledFamilyId,
        period: period,
        amount: 500
      }
    });
    assertEqual(res.status, 400, '应返回400状态码');
    assert(res.data.error && res.data.error.includes('已取消低保资格'), '错误信息不符: ' + (res.data.error || ''));
    console.log('       服务器正确拒绝:', res.data.error);
  })();

  await test('已取消资格家庭可发起资格恢复申请', async () => {
    assert(cancelledFamilyId);
    const res = await request('/api/restorations', {
      method: 'POST',
      body: {
        family_id: cancelledFamilyId,
        applicant_name: '申请人A',
        reason: '家庭情况变化，收入下降，申请恢复低保资格'
      }
    });
    assert(res.ok, '申请失败: ' + (res.data.error || ''));
    assert(res.data.id, '未返回申请ID');
    console.log('       资格恢复申请ID:', res.data.id);
  })();

  await test('获取待审核走访列表', async () => {
    const res = await request('/api/reviews/pending');
    assert(res.ok);
    assert(Array.isArray(res.data), '应返回数组');
    console.log('       待审核走访数:', res.data.length);
  })();

  await test('获取补贴发放列表', async () => {
    const res = await request('/api/subsidies');
    assert(res.ok);
    assert(Array.isArray(res.data));
    console.log('       补贴记录数:', res.data.length);
  })();

  console.log('\n' + '='.repeat(60));
  console.log('  测试结果汇总');
  console.log('='.repeat(60));
  console.log('  ✅ 通过:', passed);
  console.log('  ❌ 失败:', failed);
  console.log('  📊 总计:', passed + failed);
  console.log('='.repeat(60) + '\n');

  if (failed > 0) {
    console.log('失败用例详情:');
    results.filter(r => r.status === '❌ FAIL').forEach(r => {
      console.log('  -', r.name, ':', r.detail);
    });
    process.exit(1);
  } else {
    console.log('🎉 所有验证测试通过！');
    process.exit(0);
  }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(BASE_URL + '/api/config');
      if (res.ok) {
        console.log('✅ 服务已启动');
        await runTests();
        return;
      }
    } catch (e) {}
    process.stdout.write('.');
    await wait(1000);
  }
  console.log('\n❌ 无法连接到服务:', BASE_URL);
  console.log('请确认服务已启动并运行在 ' + BASE_URL);
  process.exit(1);
}

if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

main();
