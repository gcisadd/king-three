# Army Task 使用说明

## 1. 功能概述

`army-task.js` 会定时执行 Army Action 任务，当前配置为：

- 每轮间隔：10 秒
- 请求超时：15 秒
- 目标账号：`id=2130`
- 只有目标账号满足 `status === 1` 时，才会调用 `army-action`
- 当前不会因为 `lastError` 跳过账号（`SKIP_ERROR_ACCOUNT = false`）

账号列表仍会从接口完整获取，但实际的 Army Action 只对 `id=2130` 执行。

## 2. 启动方式

需要 Node.js 18 或更高版本，然后在当前目录执行：

```bash
node army-task.js
```

程序会持续循环运行。停止程序可以按 `Ctrl+C`。

登录手机号和密码目前配置在 `army-task.js` 顶部的 `LOGIN_PHONE` 和 `LOGIN_PASSWORD` 常量中。

## 3. 登录与鉴权

程序启动时会调用登录接口：

```text
POST http://114.67.77.189:18080/api/auth/login
```

请求体：

```json
{
  "phone": "登录手机号",
  "password": "登录密码"
}
```

登录成功后，程序读取响应中的 `data.token`，作为后续请求的认证值。后续接口会同时携带：

```text
Authorization: Bearer <data.token>
Cookie: dwsg_session=<data.token>
```

如果接口返回 HTTP 401 或 403，程序会自动重新调用登录接口获取新的 token。

## 4. 调用的接口

### 4.1 获取登录用户信息

```text
GET /api/auth/info
```

用于检查当前 token 是否有效，并输出用户昵称和用户 ID。

### 4.2 获取账号列表

```text
GET /api/account/list
```

程序从返回结果的 `data` 中读取账号列表，并筛选 `status === 1` 的账号。

### 4.3 执行 Army Action

```text
GET /api/bot/{accountId}/army-action
```

当前只有以下账号会调用此接口：

```text
accountId = 2130
```

调用成功后，程序只输出该账号返回的 `data.alerts` 内容，以及该账号的执行状态日志。

## 5. 运行流程

每一轮的执行顺序如下：

1. 检查登录状态。
2. 获取全部账号列表。
3. 筛选启用状态的账号。
4. 只保留 `id=2130`。
5. 调用该账号的 `army-action` 接口。
6. 输出执行结果和警报。
7. 等待 30 秒后开始下一轮。

## 6. 常用配置

配置位于 `army-task.js`：

```js
const LOOP_INTERVAL = 30_000;
const ACCOUNT_INTERVAL = 1500;
const REQUEST_TIMEOUT = 15_000;
const SKIP_ERROR_ACCOUNT = false;
const TARGET_ACCOUNT_ID = 2130;
```

如需更换目标账号，只需要修改 `TARGET_ACCOUNT_ID`。
