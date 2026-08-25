# @layoutkit/bree-core

可复用的 Bree 任务调度 + Express 服务核心包，内置数据库、Redis、日志、认证、Excel、邮件等开箱即用能力。

基于 **worker_threads**：任务在独立线程中执行，主进程负责调度与状态回写。

## 安装

```bash
npm install @layoutkit/bree-core
```

需自行安装 peer 依赖（`bree`、`express`、`knex`、`mssql`、`redis`、`winston`、`winston-daily-rotate-file`、`exceljs`、`nodemailer`、`dotenv`）。

## 目录结构约定

```
项目根/
├── app.js                 # 主进程：注册 hooks、scheduler、useServer
├── jobs/                  # 任务目录（也支持 src/jobs 或 dist/jobs）
│   └── test.js            # 任务文件：useHandler().run(业务函数)
├── routes/                # 路由目录（useServer 自动扫描，也支持 src/routes）
│   └── user.js
└── .env                   # 环境变量（数据库、Redis、认证等）
```

## 快速开始

### 1. 主进程 `app.js` —— 注册 hooks 并启动调度器

```js
import dotenv from 'dotenv'
dotenv.config()

import { scheduler, hooks, useServer } from '@layoutkit/bree-core'

// ===== hooks：状态回写（在主进程执行，直接赋值即生效）=====

// 任务列表：从数据库读取并注册到调度器
hooks.registerLoader = async (db, logger) => {
    const jobs = await db('My_Jobs').where('Enabled', true)
    for (const job of jobs) {
        await scheduler.create({
            name: job.Name,                 // 对应 jobs/<Name>.js
            interval: job.Interval,         // 如 '5 minutes' / '*/10 * * * * *'
            workerData: { id: job.ID },     // 回写时用业务主键 ID
        })
    }
}

// 任务成功：worker 通过 postMessage 传回结果，主进程统一回写
hooks.registerComplete = async (db, { id, result }) => {
    await db('My_Jobs').where('ID', id).update({ Status: 'done', Result: JSON.stringify(result) })
}

// 任务失败：bree errorHandler 捕获后统一回写
hooks.registerError = async (db, { id, error }) => {
    await db('My_Jobs').where('ID', id).update({ Status: 'error', Error: error })
}

// ===== 启动调度器 =====
await scheduler.register()

// ===== 启动 HTTP 服务（可选）=====
const { app } = useServer({ port: 3000, auth: false })
await app.start()
```

### 2. 任务文件 `jobs/test.js` —— worker 线程内

```js
import { useHandler } from '@layoutkit/bree-core'

const { run, getIsCancelled } = useHandler()

const test = async ({ logger, redis, db }) => {
    logger.info('任务开始')

    // 业务逻辑（可访问注入的 logger / redis / db）
    const count = await db('HI_User').count()
    await redis.set('lastCount', count, 3600)

    // 支持优雅取消：scheduler.stop('test') 后提前退出
    if (getIsCancelled()) return { cancelled: true }

    return { ok: true, count }   // 会通过 postMessage 回传给主进程
}

run(test)
```

### 3. 启动

```bash
node app.js
```

## 环境变量

| 变量 | 用途 | 示例 |
| --- | --- | --- |
| `DB_CONNECTION_STRING` | SQL Server 连接串 | `user=sa;password=123;server=127.0.0.1;database=mydb` |
| `DB_AES_KEY` | 可选，连接串为 AES 密文时用于解密 | `16/24/32字节密钥` |
| `REDIS_HOST` / `REDIS_PORT` | Redis 地址 | `127.0.0.1` / `6379` |
| `REDIS_USERNAME` / `REDIS_PASSWORD` | Redis 账号密码（可选） | |
| `REDIS_DB` | Redis 库号（默认 0） | `0` |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_ACCOUNT` / `MAIL_PASSWORD` / `MAIL_USERNAME` | SMTP 配置（MAIL_PASSWORD 为授权码） | |
| `API_SECRET_KEY` | 认证 AES 密钥 | 16/24/32字节 |
| `API_TOKEN` | 认证明文 token | |
| `API_SECRET_KEY_NAME` | 认证请求头名 | `x-api-key` |
| `ALLOW_IPS` | IP 白名单（逗号分隔） | `127.0.0.1,192.168.1.1` |
| `LOG_DIR` | 日志根目录（默认项目下 `logs`） | `/var/log` |
| `BREE_JOBS_PATH` | 任务目录（不设则自动找 `src/jobs` / `jobs` / `dist/jobs`） | `./jobs` |

## 任务调度

### 数据流

```
主进程                                   worker 线程 (jobs/<name>.js)
───────                                  ────────────────────────────
scheduler.register()
  └─ hooks.registerLoader(db, logger)     ┌─────────────────────────┐
      └─ scheduler.create(job)            │ useHandler().run(业务)  │
scheduler.start('test') / run('test') ──▶ │   ├─ worker({logger,    │
      │                                  │   │      redis, db})    │
      ▼                                  │   └─ postMessage(done)  │
worker created ─────────────────────────▶└─────────────────────────┘
      │
worker message { type:'done', data }
  └─ hooks.registerComplete(db, { id, result })

worker 抛错 ──▶ bree errorHandler
  └─ hooks.registerError(db, { id, error })
```

### hooks —— 状态回写钩子

hooks 是主进程共享对象，包含三个钩子，**直接赋值即生效**：

```js
hooks.registerLoader = async (db, logger) => { /* 读任务列表并 scheduler.create */ }
hooks.registerComplete = async (db, { id, result }) => { /* 任务成功回写 */ }
hooks.registerError = async (db, { id, error }) => { /* 任务失败回写 */ }
```

- 不赋值时使用默认空实现（不会崩溃，只提示一次）。
- 回写参数：`id` 为 `bree.add()` 时写入的 `workerData.id`（在 `registerLoader` 里通过 `workerData: { id: 业务主键 }` 自定义），`result` 为 worker 返回的数据，`error` 为异常堆栈。
- **注意**：worker 线程内存独立，主进程的 hooks 单例在 worker 里不可见，因此回写一律发生在主进程（成功走 `postMessage`，失败走 `errorHandler`），业务函数里无需也不应注入回写钩子。

### scheduler —— 调度器（主进程）

| 方法 | 说明 |
| --- | --- |
| `register()` | 初始化数据库 + Bree 实例，并调用 `hooks.registerLoader` 加载任务列表 |
| `create(job)` | 注册任务（同名已存在则跳过）。`job` 为 Bree job 配置，如 `{ name, interval, workerData }` |
| `reset(job, startStatus?)` | 停止并替换同名任务，可选是否立即启动 |
| `remove(name)` | 停止并移除任务 |
| `start(name)` | 启动（后台周期性运行） |
| `stop(name)` | 停止（向 worker 发送 cancel 消息，触发优雅取消） |
| `run(name)` | 立即执行一次 |
| `getBree()` | 获取底层 Bree 实例 |

任务文件按 `name` 对应 `jobs/<name>.js`。定时支持 Bree 的 `interval` 语法（如 `'5 minutes'`）或 cron 表达式（`hasSeconds` 已开启）。

### useHandler —— 任务执行（worker 内）

```js
import { useHandler } from '@layoutkit/bree-core'

const { run, getIsCancelled } = useHandler()

const myJob = async ({ logger, redis, db }) => { /* 业务逻辑 */ }
run(myJob)
```

- 业务函数接收 `{ logger, redis, db }`：日志、Redis 单例、knex 数据库实例均已初始化。
- **成功**：`run` 自动执行 `postMessage({ type: 'done', data: result })`，主进程调用 `hooks.registerComplete`。业务函数直接 `return` 结果即可，无需手动回写。
- **失败**：worker 抛错由 bree `errorHandler` 捕获，主进程调用 `hooks.registerError`。
- **取消**：主进程 `scheduler.stop(name)` 会向 worker 发送 `cancel` 消息，`useHandler` 内部设置取消标志；业务函数内用 `getIsCancelled()` 检查并提前退出。

## Express 服务

```js
import { useServer, route } from '@layoutkit/bree-core'

const { app } = useServer({
    port: 3000,
    auth: true,                 // true=内置认证；也可传自定义中间件函数/数组；false=关闭
    routesDir: ['routes'],      // 自动扫描路由目录，默认 ['routes', 'src/routes']
})

await app.start()
```

### 路由 —— 单函数接口风格（定义即自动注册）

```js
import { route } from '@layoutkit/bree-core'

// handler 签名：async (body, req, res) => result
// body = { ...params, ...query, ...body }，解构即用
route.post('/test', ({ name }) => {
    return { code: 0, message: 'success', data: { name } }  // 完整响应体原样返回
})

route.get('/user/:id', async ({ id }) => ({ id }))          // 普通数据自动 res.success 包装

// 分组前缀
const api = route.parentRoute('/task')
api.get('/list', async () => [])                            // GET /task/list

// 支持中间件（如 multer 上传）
route.post('/upload', upload.single('file'), async (body, req) => {
    return { code: 0, message: '上传成功', data: { filename: req.file.filename } }
})
```

- 方法：`route.get / route.post / route.put / route.delete / route.patch`，裸 `route(path, ...)` 默认 POST。
- 中间件：单个函数或函数数组，放在 handler 之前。
- 返回含 `code` 的对象原样输出，其余自动包装为 `res.success`；抛错进入全局错误处理。

### useServer 选项

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `port` | `3000` | 监听端口 |
| `host` | `0.0.0.0` | 监听地址 |
| `logger` | `createLogger({ name:'server', split:true })` | 自定义 logger |
| `jsonLimit` / `urlencodedLimit` | `10mb` | body 大小限制 |
| `cors` | `true` | 跨域；可传 `origin` 字符串或 `{ origin, methods, headers }` |
| `staticDir` | `null` | 静态资源目录（可传数组） |
| `auth` | `false` | `true`=内置认证 / 函数或数组=自定义中间件 |
| `health` | `true` | 启用 `GET /health` |
| `trustProxy` | `true` | 信任代理（影响 `req.ip`） |
| `routes` | `null` | 函数 `(app) => {}` 或路由配置数组 |
| `routesDir` | `['routes','src/routes']` | 路由文件目录，`start()` 时递归扫描自动加载；`false` 关闭 |

内置能力：请求日志（含耗时/状态码/IP）、CORS、`res.success(data, message)` / `res.fail(message, code)` 统一响应、404 与全局错误处理、健康检查。

### 内置认证 auth

```js
useServer({ auth: true })
```

- 从 `req.headers[API_SECRET_KEY_NAME]` 取密钥，值需为 **AES 密文**（用 `API_SECRET_KEY` 解密后等于 `API_TOKEN` 才通过）；
- 校验请求 IP 是否在 `ALLOW_IPS` 白名单内；
- 失败统一返回 HTTP 200 + `{ code: -1, message }`。

## 日志 createLogger

```js
import { createLogger } from '@layoutkit/bree-core'

const logger = createLogger({
    name: 'weixinapi',       // 文件名前缀 + 默认子目录名
    level: 'info',           // error | warn | info | debug（默认 info，debug 会被过滤）
    split: true,             // 按 debug/info/warn/error 拆四个文件；可传数组如 ['info','error']
    // maxSize: '10m', maxFiles: '10d', dirname: '...', console: false, file: true
})

logger.error('...')  // 输出到 stderr
logger.info('...')   // 输出到 stdout
```

- 文件：`logs/<dirname ?? name>/<name>-%DATE%.log`（按天滚动）；设置 `LOG_DIR` 后根目录变为 `<LOG_DIR>/logs`。
- 默认级别 `info`，想看到 `debug` 需显式 `level: 'debug'`。
- 默认 `maxSize: '10m'`、`maxFiles: '10d'`。

## 工具模块

### redis

```js
import { redis } from '@layoutkit/bree-core'

await redis.set('key', { a: 1 }, 3600)   // 对象自动 JSON 序列化，可选过期秒
const v = await redis.get('key')          // 自动尝试 JSON.parse
await redis.del('key')
await redis.hSet('hash', 'field', { x: 1 })
await redis.lPush('list', item)           // 列表元素 JSON 序列化
await redis.close()                       // 关闭连接
```

方法：`set` / `get` / `del` / `exists` / `expire` / `ttl` / `incr` / `decr` / `hSet` / `hGet` / `hGetAll` / `lPush` / `rPush` / `lPop` / `rPop` / `close`。

### database（knex + mssql）

```js
import { database } from '@layoutkit/bree-core'

const db = await database.init()                    // 默认读 DB_CONNECTION_STRING
const db2 = await database.init('user=..;password=..;server=..;database=..')  // 可传参覆盖
const rows = await database.get()('users').select('*')
await database.close()
```

- 连接串支持 `key=value;key=value` 格式；配置 `DB_AES_KEY` 时自动尝试 AES 解密（明文则原样使用）。
- `init()` 会先释放旧连接并 `SELECT 1` 验证真实连通。

### aes（AES/ECB/PKCS7，兼容 Java）

```js
import { aes } from '@layoutkit/bree-core'

const cipher = aes.encrypt('明文', '16字节密钥')     // 返回 Buffer
const plain  = aes.decrypt(cipher, '16字节密钥')      // 返回 Buffer
const str    = aes.decryptString('Base64密文', '16字节密钥')  // 密文字符串 → 明文
```

### excel

```js
import { excel } from '@layoutkit/bree-core'

// 统一入口：file(落盘) | buffer(邮件用) | stream(10w+ 大数据流式)
const filePath = await excel.exportExcel({
    mode: 'file',
    columns: [{ header: 'ID', key: 'id', width: 10 }],
    data: [{ id: 1 }],
    fileName: 'report',
})

excel.setFolder('exports')   // 可选：文件输出目录（相对 cwd）
```

### mail

```js
import { mail } from '@layoutkit/bree-core'

await mail.init()   // 读取 MAIL_* 环境变量
await mail.send(
    '主题',
    'a@x.com,b@x.com',      // 收件人（逗号分隔）
    'cc@x.com',             // 抄送（可选）
    '正文',
    ['/path/to/file.xlsx']  // 附件（可选，自动截取文件名）
)
```

## API 导出总览

| 导出 | 说明 |
| --- | --- |
| `scheduler` | 调度器（主进程） |
| `hooks` | 状态回写钩子（主进程共享对象） |
| `useHandler` | 任务执行器（worker 内） |
| `useServer` | Express 服务封装 |
| `route` | 单函数风格路由 |
| `auth` | 内置认证中间件 |
| `createLogger` | 日志工厂 |
| `database` | knex/mssql 数据库单例 |
| `redis` | Redis 单例 |
| `aes` | AES 加解密工具 |
| `excel` | Excel 导出工具 |
| `mail` | 邮件发送工具 |
