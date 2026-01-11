// 指纹规则数据缓存
let fingerprintData = null;

// 加载默认指纹规则数据
async function loadDefaultFingerprintData() {
  if (fingerprintData) {
    return fingerprintData;
  }
  
  try {
    const response = await fetch(chrome.runtime.getURL('finger_custom.json'));
    fingerprintData = await response.json();
    return fingerprintData;
  } catch (error) {
    console.error('加载指纹数据失败:', error);
    return null;
  }
}

// 加载用户自定义规则
async function loadCustomRules() {
  try {
    const result = await chrome.storage.local.get(['customRules']);
    return result.customRules || [];
  } catch (error) {
    console.error('加载自定义规则失败:', error);
    return [];
  }
}

// 合并默认规则和用户自定义规则
async function loadAllFingerprintData() {
  const defaultData = await loadDefaultFingerprintData();
  const customRules = await loadCustomRules();
  
  if (!defaultData || !Array.isArray(defaultData)) {
    return customRules;
  }
  
  // 合并规则，自定义规则放在前面（优先级更高）
  return [...customRules, ...defaultData];
}

// 归一化匹配关键词
function normalizeKeywords(keywords) {
  if (!Array.isArray(keywords)) {
    return [];
  }

  return keywords
    .filter(rule => typeof rule === 'string')
    .map(rule => rule.trim().toLowerCase())
    .filter(Boolean);
}

// 根据匹配模式检查文本
function matchText(sourceText, keywords, mode = 'all', preNormalized = false) {
  if (!sourceText) {
    return false;
  }

  const normalizedKeywords = normalizeKeywords(keywords);
  if (normalizedKeywords.length === 0) {
    return false;
  }

  const normalizedSource = preNormalized ? sourceText : sourceText.toLowerCase();
  if (mode === 'any') {
    return normalizedKeywords.some(keyword => normalizedSource.includes(keyword));
  }

  // 默认使用严格 AND 逻辑，避免误报
  return normalizedKeywords.every(keyword => normalizedSource.includes(keyword));
}

// 检查页面内容是否匹配规则
function checkBodyRules(bodyText, rules, preNormalized = false) {
  const mode = (rules.body_mode || rules.bodyMode || 'all').toLowerCase();
  return matchText(bodyText, rules.body, mode === 'any' ? 'any' : 'all', preNormalized);
}

// 检查 HTTP 响应头是否匹配规则
function checkHeaderRules(headers, rules, preNormalized = false) {
  const mode = (rules.header_mode || rules.headerMode || 'all').toLowerCase();
  const headerString = typeof headers === 'string'
    ? headers
    : headers
      ? JSON.stringify(headers)
      : '';
  return matchText(headerString, rules.header, mode === 'any' ? 'any' : 'all', preNormalized || typeof headers === 'string');
}

// 获取页面内容
function getPageContent() {
  return document.documentElement.outerHTML || document.body.innerHTML || '';
}

// 获取 HTTP 响应头（通过 fetch 请求）
async function getResponseHeaders(url) {
  try {
    const response = await fetch(url, { 
      method: 'HEAD',
      mode: 'same-origin' // 只获取同源响应头，避免 CORS 问题
    });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  } catch (error) {
    // 静默失败，header 规则是可选的
    return null;
  }
}

// 执行指纹识别
async function identifyFingerprint() {
  const data = await loadAllFingerprintData();
  if (!data || !Array.isArray(data) || data.length === 0) {
    return [];
  }
  
  const results = [];
  const pageContent = (getPageContent() || '').toLowerCase();
  const currentUrl = window.location.href;
  
  // 获取响应头（异步，但不阻塞识别）
  let responseHeaders = null;
  let normalizedHeaders = '';
  try {
    responseHeaders = await getResponseHeaders(currentUrl);
    normalizedHeaders = responseHeaders ? JSON.stringify(responseHeaders).toLowerCase() : '';
  } catch (e) {
    // 忽略错误，继续使用 body 规则识别
  }
  
  // 遍历所有指纹规则
  for (const fingerprint of data) {
    if (!fingerprint.rules) {
      continue;
    }
    
    let matched = false;
    let matchType = '';
    
    // 检查 body 规则
    if (fingerprint.rules.body && Array.isArray(fingerprint.rules.body)) {
      if (checkBodyRules(pageContent, fingerprint.rules, true)) {
        matched = true;
        matchType = 'Body 内容匹配';
      }
    }
    
    // 检查 header 规则
    if (!matched && fingerprint.rules.header && Array.isArray(fingerprint.rules.header) && normalizedHeaders) {
      if (checkHeaderRules(normalizedHeaders, fingerprint.rules, true)) {
        matched = true;
        matchType = 'HTTP Header 匹配';
      }
    }
    
    // 如果匹配，添加到结果中
    if (matched) {
      results.push({
        product_name: fingerprint.product_name || '未知产品',
        company: fingerprint.company || '',
        industry: fingerprint.industry || '',
        level: fingerprint.level !== undefined ? fingerprint.level : 0,
        matchType: matchType
      });
    }
  }
  
  // 按 level 排序（level 越小优先级越高）
  results.sort((a, b) => a.level - b.level);
  
  return results;
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'identify') {
    // 异步执行识别
    identifyFingerprint().then(results => {
      sendResponse(results);
    }).catch(error => {
      console.error('识别过程出错:', error);
      sendResponse([]);
    });
    
    // 返回 true 表示将异步发送响应
    return true;
  }
});

