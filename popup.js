// 获取当前标签页信息
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// 加载指纹规则数据
async function loadFingerprintData() {
  try {
    const response = await fetch(chrome.runtime.getURL('finger_custom.json'));
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('加载指纹数据失败:', error);
    return null;
  }
}

// 显示识别结果
function displayResults(results) {
  const resultSection = document.getElementById('resultSection');
  const resultContent = document.getElementById('resultContent');
  
  if (!results || results.length === 0) {
    resultContent.innerHTML = '<div class="no-result">未识别到匹配的产品</div>';
    resultSection.style.display = 'block';
    return;
  }
  
  let html = '';
  results.forEach(result => {
    html += `
      <div class="result-item">
        <div class="product-name">${escapeHtml(result.product_name)}</div>
        ${result.company ? `<div class="product-info">公司: ${escapeHtml(result.company)}</div>` : ''}
        ${result.industry ? `<div class="product-info">行业: ${escapeHtml(result.industry)}</div>` : ''}
        <div class="product-info">置信度: ${result.level}</div>
        <div class="match-info">匹配规则: ${result.matchType}</div>
      </div>
    `;
  });
  
  resultContent.innerHTML = html;
  resultSection.style.display = 'block';
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 更新按钮状态
function setButtonState(loading, text = '开始识别') {
  const btn = document.getElementById('identifyBtn');
  const btnText = btn.querySelector('.btn-text');
  const btnLoader = btn.querySelector('.btn-loader');
  
  if (loading) {
    btn.disabled = true;
    btnText.textContent = '识别中...';
    btnLoader.style.display = 'block';
  } else {
    btn.disabled = false;
    btnText.textContent = text;
    btnLoader.style.display = 'none';
  }
}

// 打开指纹规则生成器
function openFingerprintGenerator() {
  chrome.tabs.create({
    url: 'https://index.zgsfsys.cn/finger/index.html'
  });
}

// 显示/隐藏添加规则模态框
function showAddRuleModal() {
  document.getElementById('addRuleModal').style.display = 'flex';
}

function hideAddRuleModal() {
  document.getElementById('addRuleModal').style.display = 'none';
  document.getElementById('ruleForm').reset();
  // 重置规则输入
  document.getElementById('bodyRules').innerHTML = '<div class="rule-input-group"><input type="text" class="rule-input" placeholder="输入匹配关键词"><button type="button" class="btn-remove-rule">删除</button></div>';
  document.getElementById('headerRules').innerHTML = '<div class="rule-input-group"><input type="text" class="rule-input" placeholder="输入匹配关键词"><button type="button" class="btn-remove-rule">删除</button></div>';
}

// 添加规则输入框
function addRuleInput(type) {
  const container = document.getElementById(type + 'Rules');
  const div = document.createElement('div');
  div.className = 'rule-input-group';
  div.innerHTML = `
    <input type="text" class="rule-input" placeholder="输入匹配关键词">
    <button type="button" class="btn-remove-rule">删除</button>
  `;
  container.appendChild(div);
  
  // 绑定删除按钮
  div.querySelector('.btn-remove-rule').addEventListener('click', () => {
    if (container.children.length > 1) {
      div.remove();
    }
  });
}

// 保存用户自定义规则
async function saveCustomRule(ruleData) {
  try {
    const result = await chrome.storage.local.get(['customRules']);
    const customRules = result.customRules || [];
    customRules.push(ruleData);
    await chrome.storage.local.set({ customRules });
    return true;
  } catch (error) {
    console.error('保存规则失败:', error);
    return false;
  }
}

// 处理表单提交
async function handleRuleFormSubmit(e) {
  e.preventDefault();
  
  const productName = document.getElementById('productName').value.trim();
  const company = document.getElementById('company').value.trim();
  const industry = document.getElementById('industry').value.trim();
  const level = parseInt(document.getElementById('level').value);
  
  if (!productName) {
    alert('请输入产品名称');
    return;
  }
  
  // 收集 Body 规则
  const bodyRules = [];
  document.querySelectorAll('#bodyRules .rule-input').forEach(input => {
    const value = input.value.trim();
    if (value) {
      bodyRules.push(value);
    }
  });
  
  // 收集 Header 规则
  const headerRules = [];
  document.querySelectorAll('#headerRules .rule-input').forEach(input => {
    const value = input.value.trim();
    if (value) {
      headerRules.push(value);
    }
  });
  
  if (bodyRules.length === 0 && headerRules.length === 0) {
    alert('请至少添加一个 Body 或 Header 规则');
    return;
  }
  
  const ruleData = {
    product_name: productName,
    company: company || undefined,
    industry: industry || undefined,
    level: level,
    rules: {}
  };
  
  if (bodyRules.length > 0) {
    ruleData.rules.body = bodyRules;
  }
  
  if (headerRules.length > 0) {
    ruleData.rules.header = headerRules;
  }
  
  const success = await saveCustomRule(ruleData);
  if (success) {
    alert('规则添加成功！');
    hideAddRuleModal();
  } else {
    alert('规则添加失败，请重试');
  }
}

// 执行识别
async function performIdentification() {
  setButtonState(true);
  
  try {
    const tab = await getCurrentTab();
    if (!tab || !tab.url) {
      throw new Error('无法获取当前标签页信息');
    }
    
    // 检查是否是有效的 HTTP/HTTPS 页面
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
      throw new Error('当前页面不支持识别（仅支持 HTTP/HTTPS 页面）');
    }
    
    // 向内容脚本发送识别请求
    const results = await chrome.tabs.sendMessage(tab.id, {
      action: 'identify',
      url: tab.url
    });
    
    displayResults(results);
    setButtonState(false, '重新识别');
    
  } catch (error) {
    console.error('识别失败:', error);
    const resultSection = document.getElementById('resultSection');
    const resultContent = document.getElementById('resultContent');
    resultContent.innerHTML = `<div class="no-result" style="color: #e74c3c;">识别失败: ${error.message}</div>`;
    resultSection.style.display = 'block';
    setButtonState(false, '开始识别');
  }
}

// 初始化
async function init() {
  const tab = await getCurrentTab();
  if (tab && tab.url) {
    const urlDisplay = document.getElementById('currentUrl');
    try {
      const url = new URL(tab.url);
      urlDisplay.textContent = url.hostname + url.pathname;
    } catch (e) {
      urlDisplay.textContent = tab.url;
    }
  }
  
  // 绑定识别按钮事件
  document.getElementById('identifyBtn').addEventListener('click', performIdentification);
  
  // 绑定添加规则按钮事件
  document.getElementById('addRuleBtn').addEventListener('click', showAddRuleModal);
  
  // 绑定指纹规则生成按钮事件
  document.getElementById('generateBtn').addEventListener('click', openFingerprintGenerator);
  
  // 绑定模态框关闭事件
  document.getElementById('closeModal').addEventListener('click', hideAddRuleModal);
  document.getElementById('cancelBtn').addEventListener('click', hideAddRuleModal);
  document.getElementById('addRuleModal').addEventListener('click', (e) => {
    if (e.target.id === 'addRuleModal') {
      hideAddRuleModal();
    }
  });
  
  // 绑定表单提交事件
  document.getElementById('ruleForm').addEventListener('submit', handleRuleFormSubmit);
  
  // 绑定添加规则输入框按钮
  document.querySelectorAll('.btn-add-rule').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      addRuleInput(type);
    });
  });
  
  // 绑定初始删除按钮
  document.querySelectorAll('.btn-remove-rule').forEach(btn => {
    btn.addEventListener('click', function() {
      const container = this.closest('#bodyRules') || this.closest('#headerRules');
      if (container && container.children.length > 1) {
        this.closest('.rule-input-group').remove();
      }
    });
  });
  
  // 预加载指纹数据（可选，用于验证数据是否可用）
  const data = await loadFingerprintData();
  if (!data) {
    console.warn('指纹数据加载失败，识别功能可能不可用');
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

