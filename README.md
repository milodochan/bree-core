# bree-core

内部 Bree 调度封装包。

## 安装

npm install @layoutkit/bree-core

## 使用

```js
import { scheduler } from '@layoutkit/bree-core';

// 初始化bree任务（默认从任务表读取任务，表名默认 Sys_BreeJobs）
scheduler.init()
```

**任务表配置**：

```js
// scheduler：默认从任务表读取任务（表名默认 Sys_BreeJobs），也可通过钩子交给引用项目
scheduler.init({
    listJobs: async () => await myDb('My_Jobs'),                    // 钩子：读取任务列表
    updateJob: async (id, patch) => await myDb('My_Jobs').where('ID', id).update(patch)   // 钩子：更新任务字段
});
```

**公用钩子**（`hooks`）：集中配置任务状态回写等扩展点，在应用入口（如 `app.js`）赋值一次全局生效，后续新增钩子只需在 `src/core/hooks.js` 扩展字段：

```js
// ===== app.js（应用入口，配置一次全局生效）=====
import { hooks } from '@layoutkit/bree-core';

// 任务成功回写（obj: { id, ResultStatus: 0, ExecuteResult }）
hooks.registerComplete = async (db, obj) => {
    await db('My_Jobs').where('id', obj.id).update('ExecuteResult', obj.ExecuteResult);
};

// 任务失败回写（obj: { id, ResultStatus: 1, ErrorMessage }）
hooks.registerError = async (db, obj) => {
    await db('My_Jobs').where('id', obj.id).update('ErrorMessage', obj.ErrorMessage);
};

// registerLoader：任务加载钩子（预留给 scheduler 使用，暂未接入）
```

**worker 状态回写**（`useHandler`，无需传参）：

```js
// ===== jobs/xxx.js（worker 文件，正常使用）=====
import { useHandler } from '@layoutkit/bree-core';

const { run } = useHandler();

await run(async ({ logger, redis, db }) => {
    // ...业务逻辑...
    return result;  // 成功自动回调 hooks.registerComplete
    // 抛错自动回调 hooks.registerError
});
```

> 未配置对应钩子时该次回写将被跳过。

## 日志

内置 logger（info / worker / weixinapi），也可通过 `createLogger` 按参数创建：

```js
import winston from 'winston';
import { createLogger } from '@layoutkit/bree-core';

const { printf } = winston.format;

const myLogger = createLogger({
    name: 'myapp',          // 文件名前缀 -> myapp-%DATE%.log
    dirname: 'logs/myapp',  // 日志目录（相对 cwd）
    level: 'debug',         // 日志级别：error | warn | info | debug
    console: true,          // 是否输出控制台
    file: true,             // 是否输出文件
    datePattern: 'YYYY-MM-DD', // 日志文件名日期格式
    maxSize: '20m',         // 单文件大小上限，超过滚动
    maxFiles: '30d',        // 日志保留时长，如 '30d' 或份数 14
    format: printf(({ timestamp, level, message }) =>
        `[${timestamp}] [${level.toUpperCase()}] ${message}`), // 自定义格式
    split: true,            // 按 debug/info/warn/error 分文件，或传数组如 ['info','warn','error']
    envDir: true            // 可选：启用环境变量目录，最终目录 = process.env.LOG_DIR + dirname
});

myLogger.info('hello');
myLogger.error(new Error('oops'));
```

> `envDir` 使用说明：
> - `envDir: true` 时，最终日志目录 = `process.env.LOG_DIR` 拼接 `dirname`（此时 `dirname` 仅作子目录名），例如 `LOG_DIR=/var/log/app` + `dirname: 'jobs'` → `/var/log/app/jobs`
> - `LOG_DIR` 未设置时回退到 `dirname` 本身（相对 cwd）
> - 不启用 `envDir` 时保持原逻辑：`dirname` 直接作为日志目录（相对 cwd 或绝对路径）

- `split: false`（默认）：全部级别写入 `<name>-%DATE%.log`
- `split: true`：按 `debug/info/warn/error` 各写一个文件（`<name>-<level>-%DATE%.log`）
- `split: ['info', 'warn', 'error']`：只按指定级别拆分

### 获取日志文件完整路径

创建的 logger 附带 `getFilePaths()` / `getFilePath(level)` 方法（返回当前正在写入的文件）：

```js
// 所有日志文件（split 时含级别）
logger.getFilePaths();
// -> [{ level: 'debug', path: '/var/log/app/jobs/app-debug-2026-08-24.log' }, ...]

// 指定级别（未拆分时忽略 level 返回唯一文件）
logger.getFilePath('error');
// -> '/var/log/app/jobs/app-error-2026-08-24.log'

// 不传参数返回第一个文件
logger.getFilePath();
```

## Express 服务

通过 `useServer` 快速创建完整的 Express 服务：

```js
import { useServer } from '@layoutkit/bree-core';

const { app, start, stop } = useServer({
    port: 3000,
    logger: createLogger({ name: 'api', split: true }),
    cors: true,                         // true | origin 字符串 | { origin, methods, headers }
    staticDir: 'public',                // 静态资源目录（可传数组）
    auth: false,                        // false 不启用 | true 内置 auth（需配 API_SECRET_KEY/API_TOKEN/ALLOW_IPS）
                                        // | 自定义中间件函数或函数数组
    health: true,                       // GET /health 健康检查
    routes: (app) => {                  // 方式一：函数注册
        app.get('/hello', (req, res) => res.success({ msg: 'hi' }));
    }
});

await start();
```

路由也可用配置数组方式（express 5 的 async handler 抛错会自动进入全局错误处理）：

```js
const { app, start } = useServer({
    port: 3000,
    routes: [
        { method: 'get', path: '/hello', handler: (req, res) => res.success({ msg: 'hi' }) },
        { method: 'post', path: '/users', handler: [checkToken, async (req, res) => {
            // async 抛错会被全局错误处理捕获
        }] }
    ]
});

await start();
```

**认证支持外部自定义中间件**（不依赖内置 auth 的环境变量）：

```js
// 自定义校验中间件
const checkToken = (req, res, next) => {
    const token = req.headers['x-api-key'];
    if (token !== 'secret') return res.fail('Unauthorized', 401);
    next();
};

const { start } = useServer({
    port: 3000,
    auth: checkToken,        // 传函数；也支持函数数组 [checkToken, checkIp]
    routes: (app) => { app.get('/api', (req, res) => res.success()); }
});

await start();
```

### 单函数接口风格（`route`）

JS 不支持 `@Route` 装饰器语法（装饰器只能用于 class），用 `route(path, handler)` 函数包装实现近似效果，定义即自动注册：

```js
// ===== routes/user.js（业务模块）=====
import { route } from '@layoutkit/bree-core';

// 定义即自动注册，无需导出、无需传入 useServer
route.post('/test', (body) => {
    const { name, age } = body;   // body 自动合并 params/query/body
    return { code: 0, message: 'success', data: null };  // 完整响应体原样返回
});

route.get('/user/:id', async ({ id }) => ({ id }));
```

```js
// ===== app.js（入口，只负责启动）=====
import { useServer } from '@layoutkit/bree-core';

const { start } = useServer({ port: 3000 });  // 启动时自动扫描 routes 目录加载路由文件
await start();
```

业务路由文件放在项目根目录 `routes/` 下即可（可嵌套子目录），**无需手动 import**，`useServer` 启动时自动递归扫描加载。

**规则：**

- **定义即自动注册**：`route(...)` 调用时自动收集，`useServer` 启动时自动加载（同 method+path 重复定义覆盖旧路由）
- **自动扫描**：默认扫描 `routes` 目录（相对 cwd）下所有 `.js/.mjs/.cjs` 文件；可用 `routesDir` 自定义目录（传数组可扫多个，传 `false` 关闭扫描），如 `useServer({ routesDir: 'src/routes' })`
- 默认 `POST`；方法类型便捷写法：`route.get(path, handler)`、`route.post(path, handler)`、`route.put`、`route.delete`、`route.patch`
- 也可 `route(path, handler, method)` 指定方法
- 返回带 `code` 字段的对象 → 原样 `res.json` 输出（自定义完整响应体）
- 返回普通数据 → 自动包装为 `res.success(result)`
- 抛错自动进入全局错误处理
- 自动注册的路由与手动传入的 `routes` 混用，全局按静态路径优先排序

**内置能力：**

- 统一响应格式：`res.success(data, message)` → `{ code: 0, message, data }`；`res.fail(message, code)` → `{ code, message, data: null }`
- 请求日志：自动记录 `method url statusCode 耗时ms ip`
- 全局错误处理：express 5 自动捕获 async 异常，统一 JSON 返回；404 统一 `{ code: 404, message: 'Not Found' }`
- body 解析：JSON / urlencoded，默认上限 `10mb`（`jsonLimit`/`urlencodedLimit` 可调）
- CORS 中间件内置实现，不依赖额外包
- 静态资源、认证、健康检查均为可选开关
- `stop()` 优雅关闭服务
