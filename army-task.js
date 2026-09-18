/**
 * army-task.js
 * 启动指令 node army-task.js
 *
 * 功能：
 * 1. 检查登录状态
 * 2. 获取账号列表
 * 3. 筛选在线且无错误的账号
 * 4. 调用 army-action
 * 5. 定时循环执行
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

const BASE_URL = 'http://114.67.77.189:18080';

// 登录接口参数
const LOGIN_PHONE = '17305005500';
const LOGIN_PASSWORD = 'asdzxc123456';

// 登录成功后从接口响应中动态获取，不在代码中写死 token。
let AUTH = '';

// ========================
// 配置
// ========================

// 每一轮结束后等待时间
const LOOP_INTERVAL = 30_000;

// alert 日志写入间隔
const ALERT_LOG_INTERVAL = 5 * 60 * 1000;

// alert 日志最多保存组数（每次接口获取的数据为一组）
const MAX_ALERT_LOG_GROUPS = 200;

// 普通运行时使用脚本目录，打包后使用 exe 所在目录
const APP_DIR = process.pkg
  ? path.dirname(process.execPath)
  : __dirname;

// macOS .app 通过启动器指定数据目录，普通运行仍使用脚本 / exe 同目录
const DATA_DIR = process.env.ARMY_TASK_DATA_DIR || APP_DIR;

// alert 日志文件（与当前脚本 / exe 同目录）
const ALERT_LOG_FILE = path.join(DATA_DIR, 'alert-logs');

// 看板页面会由本地 HTTP 服务提供
const ALERT_DASHBOARD_FILE = path.join(
  __dirname,
  'alert-dashboard.html',
);

// 设为 0，让系统自动分配空闲端口，避免端口冲突
const DASHBOARD_PORT = 0;

// 不同账号之间请求间隔
const ACCOUNT_INTERVAL = 1500;

// 请求超时时间
const REQUEST_TIMEOUT = 15_000;

// 是否只执行没有 lastError 的账号
const SKIP_ERROR_ACCOUNT = false;

// 只调用这个账号的 army-action
const TARGET_ACCOUNT_ID = 2130;

// 等待下次定时写入的 alert 组
let pendingAlertLogGroups = [];
let alertLogTimer;
let alertFlushPromise;
let dashboardServer;

// ========================
// 工具方法
// ========================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function now() {
  return new Date().toLocaleString();
}

function log(...args) {
  console.log(`[${now()}]`, ...args);
}

function errorLog(...args) {
  console.error(`[${now()}]`, ...args);
}

function queueAlertLogs(alerts, account) {
  if (alerts.length === 0) {
    return;
  }

  const fetchedAt = new Date().toISOString();
  const alertGroup = alerts.map(alert => ({
    time: fetchedAt,
    accountId: account.id,
    characterName: account.characterName ?? '',
    serverName: account.serverName ?? '',
    alert,
  }));

  pendingAlertLogGroups.push(alertGroup);
}

async function readAlertLogs() {
  try {
    const content = await fs.readFile(
      ALERT_LOG_FILE,
      'utf8',
    );

    if (!content.trim()) {
      return [];
    }

    const logs = JSON.parse(content);

    if (!Array.isArray(logs)) {
      throw new Error('alert-logs 文件内容不是数组');
    }

    // 兼容旧版“所有 alert 平铺在同一个数组”的格式
    return logs.map(log => {
      if (Array.isArray(log)) {
        return log;
      }

      if (log && typeof log === 'object') {
        return [log];
      }

      throw new Error('alert-logs 文件包含无效记录');
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function writePendingAlertLogs() {
  if (pendingAlertLogGroups.length === 0) {
    return;
  }

  const newGroups = pendingAlertLogGroups;
  pendingAlertLogGroups = [];

  try {
    const oldLogs = await readAlertLogs();
    const logs = [
      ...oldLogs,
      ...newGroups,
    ].slice(-MAX_ALERT_LOG_GROUPS);

    const tempFile = `${ALERT_LOG_FILE}.${process.pid}.tmp`;

    await fs.writeFile(
      tempFile,
      `${JSON.stringify(logs, null, 2)}\n`,
      'utf8',
    );
    await fs.rename(tempFile, ALERT_LOG_FILE);

    log(
      `alert 已写入 ${path.basename(ALERT_LOG_FILE)}`,
      `新增组数=${newGroups.length}`,
      `新增alert=${newGroups.reduce((total, group) => total + group.length, 0)}`,
      `保留组数=${logs.length}`,
    );
  } catch (error) {
    // 写入失败时恢复到队列，避免 alert 丢失
    pendingAlertLogGroups = [
      ...newGroups,
      ...pendingAlertLogGroups,
    ];

    throw error;
  }
}

async function flushAlertLogs() {
  // 避免定时写入和退出时写入同时操作同一个文件
  if (alertFlushPromise) {
    return alertFlushPromise;
  }

  alertFlushPromise = writePendingAlertLogs();

  try {
    await alertFlushPromise;
  } finally {
    alertFlushPromise = undefined;
  }
}

function startAlertLogWriter() {
  alertLogTimer = setInterval(() => {
    flushAlertLogs().catch(error => {
      errorLog(
        'alert 写入失败:',
        error.message,
      );
    });
  }, ALERT_LOG_INTERVAL);
}

async function getDashboardAlertGroups() {
  const savedGroups = await readAlertLogs();

  // 将尚未到落盘时间的新 alert 也返回给看板，避免看板等待日志落盘
  return [
    ...savedGroups,
    ...pendingAlertLogGroups,
  ].slice(-MAX_ALERT_LOG_GROUPS);
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(data));
}

function openDashboard(url) {
  let command;
  let args;

  if (process.platform === 'win32') {
    command = process.env.ComSpec || 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  execFile(command, args, error => {
    if (error) {
      errorLog(
        `自动打开看板失败，请手动打开 ${url}:`,
        error.message,
      );
    }
  });
}

async function startDashboardServer() {
  dashboardServer = http.createServer(
    async (request, response) => {
      try {
        const requestUrl = new URL(
          request.url ?? '/',
          'http://127.0.0.1',
        );

        if (requestUrl.pathname === '/api/alerts') {
          const allGroups = await getDashboardAlertGroups();
          const latestGroup = allGroups.at(-1) ?? [];

          sendJson(response, 200, {
            groups: latestGroup.length > 0
              ? [latestGroup]
              : [],
            refreshIntervalMs: LOOP_INTERVAL,
            updatedAt: new Date().toISOString(),
          });
          return;
        }

        if (
          requestUrl.pathname === '/' ||
          requestUrl.pathname === '/alert-dashboard.html'
        ) {
          const html = await fs.readFile(
            ALERT_DASHBOARD_FILE,
            'utf8',
          );

          response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/html; charset=utf-8',
          });
          response.end(html);
          return;
        }

        response.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        response.end('Not Found');
      } catch (error) {
        errorLog('看板服务请求失败:', error.message);
        sendJson(response, 500, {
          error: '看板服务暂时不可用',
        });
      }
    },
  );

  await new Promise((resolve, reject) => {
    dashboardServer.once('error', reject);
    dashboardServer.listen(
      DASHBOARD_PORT,
      '127.0.0.1',
      resolve,
    );
  });

  const address = dashboardServer.address();
  const port = typeof address === 'object' && address
    ? address.port
    : DASHBOARD_PORT;
  const url = `http://127.0.0.1:${port}/`;

  log(`alert 看板地址: ${url}`);
  openDashboard(url);
}

// ========================
// HTTP 请求
// ========================

async function request(path, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT);

  try {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      ...(AUTH
        ? {
            Authorization: `Bearer ${AUTH}`,
            Cookie: `dwsg_session=${AUTH}`,
          }
        : {}),
      ...(options.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers ?? {}),
    };

    const response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    // 登录失效
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `AUTH_EXPIRED: HTTP ${response.status}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${path}: ${text}`,
      );
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        `请求超时 (${REQUEST_TIMEOUT / 1000}s): ${path}`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ========================
// API
// ========================

async function login() {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: {
      password: LOGIN_PASSWORD,
      phone: LOGIN_PHONE,
    },
  });

  if (
    result?.code !== 200 ||
    typeof result?.data?.token !== 'string' ||
    !result.data.token
  ) {
    throw new Error(
      `登录接口返回异常: ${JSON.stringify(result)}`,
    );
  }

  AUTH = result.data.token;

  return result.data;
}

async function getAuthInfo() {
  return request('/api/auth/info');
}

async function getAccountList() {
  const result = await request('/api/account/list');

  if (result?.code !== 200) {
    throw new Error(
      `account/list 返回异常: ${JSON.stringify(result)}`,
    );
  }

  return Array.isArray(result.data)
    ? result.data
    : [];
}

async function armyAction(accountId) {
  return request(
    `/api/bot/${accountId}/army-action`,
  );
}

// ========================
// 账号筛选
// ========================

function isRunnable(account) {
  // 必须启用
  if (account.status !== 1) {
    return false;
  }

  // 是否跳过带有错误信息的账号
  if (
    SKIP_ERROR_ACCOUNT &&
    account.lastError?.trim()
  ) {
    return false;
  }

  return true;
}

// ========================
// 执行单个账号
// ========================

async function executeAccount(account) {
  const start = Date.now();
  const shouldOutput = account.id === TARGET_ACCOUNT_ID;

  if (shouldOutput) {
    log(
      `开始执行`,
      `id=${account.id}`,
      `角色=${account.characterName}`,
      `服务器=${account.serverName}`,
    );
  }

  try {
    const result = await armyAction(account.id);

    const cost = Date.now() - start;

    if (shouldOutput) {
      log(
        `✅ 执行成功`,
        `id=${account.id}`,
        `角色=${account.characterName}`,
        `耗时=${cost}ms`,
      );
    }

    const alerts = Array.isArray(result?.data?.alerts)
      ? result.data.alerts
      : [];

    queueAlertLogs(alerts, account);

    if (account.id === TARGET_ACCOUNT_ID) {
      for (const alert of alerts) {
        console.log(
          `[${account.characterName}] ${alert.display}`,
        );
      }
    }

    return true;
  } catch (error) {
    const cost = Date.now() - start;

    if (shouldOutput) {
      errorLog(
        `❌ 执行失败`,
        `id=${account.id}`,
        `角色=${account.characterName}`,
        `耗时=${cost}ms`,
        `错误=${error.message}`,
      );
    }

    return false;
  }
}

// ========================
// 执行一轮
// ========================

async function runOnce() {
  log('');
  log('================================');
  log('开始新一轮任务');
  log('================================');

  // 1. 检查登录
  const auth = await getAuthInfo();

  if (auth?.code !== 200) {
    throw new Error(
      `登录状态异常: ${JSON.stringify(auth)}`,
    );
  }

  log(
    `登录正常`,
    `用户=${auth.data?.nickname ?? '-'}`,
    `userId=${auth.data?.userId ?? '-'}`,
  );

  // 2. 获取账号
  const accounts = await getAccountList();

  log(`获取账号数量: ${accounts.length}`);

  // 3. 筛选
  const runnableAccounts =
    accounts.filter(isRunnable);

  log(
    `本轮可执行账号: ${runnableAccounts.length}`,
  );

  const targetAccounts = runnableAccounts.filter(
    account => account.id === TARGET_ACCOUNT_ID,
  );

  log(
    `本轮目标账号: ${targetAccounts.length}`,
  );

  if (targetAccounts.length === 0) {
    log('当前没有符合条件的账号');
    return;
  }

  // 显示准备执行的账号
  for (const account of targetAccounts) {
    log(
      `  - ${account.characterName}`,
      `id=${account.id}`,
      account.serverName,
    );
  }

  let successCount = 0;
  let failedCount = 0;

  // 4. 顺序执行
  for (
    let i = 0;
    i < targetAccounts.length;
    i++
  ) {
    const account = targetAccounts[i];

    const success =
      await executeAccount(account);

    if (success) {
      successCount++;
    } else {
      failedCount++;
    }

    // 最后一个账号执行完成之后不等待
    if (i < targetAccounts.length - 1) {
      await sleep(ACCOUNT_INTERVAL);
    }
  }

  log('');
  log(
    `本轮完成`,
    `成功=${successCount}`,
    `失败=${failedCount}`,
  );
}

// ========================
// 主循环
// ========================

async function main() {
  log('Army Action 自动任务启动');

  await startDashboardServer();

  const loginInfo = await login();

  log(
    `登录成功`,
    `用户=${loginInfo.nickname ?? '-'}`,
    `userId=${loginInfo.userId ?? '-'}`,
  );

  log(
    `循环间隔: ${LOOP_INTERVAL / 1000}s`,
  );

  log(
    `账号间隔: ${ACCOUNT_INTERVAL / 1000}s`,
  );

  log(
    `alert 写入间隔: ${ALERT_LOG_INTERVAL / 60_000} 分钟`,
  );

  startAlertLogWriter();

  while (true) {
    try {
      await runOnce();
    } catch (error) {
      errorLog(
        '本轮任务发生异常:',
        error.message,
      );

      // Token / Session 失效
      if (
        error.message.includes('AUTH_EXPIRED')
      ) {
        errorLog('');
        errorLog(
          '认证信息已经失效，正在重新登录。',
        );

        const loginInfo = await login();

        log(
          `重新登录成功`,
          `用户=${loginInfo.nickname ?? '-'}`,
          `userId=${loginInfo.userId ?? '-'}`,
        );

        continue;
      }
    }

    log(
      `等待 ${LOOP_INTERVAL / 1000} 秒后执行下一轮...`,
    );

    await sleep(LOOP_INTERVAL);
  }
}

// ========================
// 优雅退出
// ========================

process.on('SIGINT', async () => {
  if (alertLogTimer) {
    clearInterval(alertLogTimer);
  }

  if (dashboardServer) {
    dashboardServer.close();
  }

  log('');
  log('收到退出信号，任务停止。');

  try {
    await flushAlertLogs();
  } catch (error) {
    errorLog(
      '退出前写入 alert 失败:',
      error.message,
    );
  }

  process.exit(0);
});

process.on(
  'unhandledRejection',
  error => {
    errorLog(
      'Unhandled rejection:',
      error,
    );
  },
);

main().catch(error => {
  errorLog(
    '程序启动失败:',
    error,
  );

  process.exit(1);
});
