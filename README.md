# Army Task 使用说明

## 1. 功能概述

`army-task.js` 会定时执行 Army Action 任务，当前配置为：

- 每轮间隔：30 秒
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

调用成功后，程序会输出该账号返回的 `data.alerts` 内容，并将 alert 提供给本地看板；看板会自动刷新显示最新数据。

## 5. 运行流程

每一轮的执行顺序如下：

1. 检查登录状态。
2. 获取全部账号列表。
3. 筛选启用状态的账号。
4. 只保留 `id=2130`。
5. 调用该账号的 `army-action` 接口。
6. 输出执行结果和警报，并更新本地看板数据。
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

## 7. 打包成 Windows EXE

项目已经配置好打包命令。构建机需要安装 Node.js 和 npm，并保持网络可用，然后在项目目录执行：

```bash
npm run build:win
```

生成文件：

```text
dist/army-task.exe
```

双击 `army-task.exe` 后，程序会：

1. 启动 Army Action 定时任务。
2. 启动本地 alert 看板服务。
3. 自动打开默认浏览器中的看板页面。
4. 按 `LOOP_INTERVAL` 的频率自动刷新看板；当前为每 30 秒刷新一次。

看板会读取已经写入 `alert-logs` 的记录，也会显示尚未到 5 分钟落盘时间的新 alert，但页面只展示最近一次接口获取的最新一组数据。将 `dist/army-task.exe` 复制到其他 Windows 电脑后直接运行即可，不需要额外安装 Node.js。`alert-logs` 会生成在 exe 同目录下。

## 8. macOS 点击启动

截图中的 `army-task-macos` 是命令行可执行文件，适合在终端启动。若希望在 Finder 中双击后直接运行并打开看板，请生成 macOS 应用包：

Apple Silicon Mac：

```bash
npm run build:mac-app
```

Intel Mac：

```bash
npm run build:mac-app:intel
```

生成：

```text
dist/ArmyTask.app
```

双击 `ArmyTask.app` 即可启动任务并自动打开看板，不需要再输入终端命令。应用会将 `alert-logs` 写入 `ArmyTask.app` 所在目录。

说明：这套 `.app` 方案适用于 macOS。iPhone/iPad 的 iOS 不能直接运行 Node.js 可执行文件，需要另行开发原生 App 或访问部署后的网页服务。
