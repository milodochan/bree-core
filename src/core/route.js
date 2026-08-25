/**
 * 单函数接口风格路由（近似 `@Route('/path')` 装饰器，纯 JS 用函数包装实现）
 *
 * 用法（业务模块中定义即自动注册，无需手动传给 useServer）：
 *   route.post('/test', (body) => {
 *       const { name, age } = body
 *       return { code: 0, message: 'success', data: null }  // 完整响应体原样返回
 *   })
 *   route.get('/user/:id', async ({ id }) => ({ id }))
 *
 * 分组前缀（减少重复路径）：
 *   const api = route.parentRoute('/task')
 *   api.post('/upload', upload.single('file'), async (body, req) => {
 *       // 注册为 POST /task/upload
 *       if (!req.file) return { code: -1, message: '文件不能为空' }
 *       return { code: 0, message: '上传成功', data: { filename: req.file.filename } }
 *   })
 *   api.get('/list', async () => [])   // GET /task/list
 *   api.parentRoute('/:id').get('/info', async ({ id }) => ({}))  // 支持嵌套，GET /task/:id/info
 *
 * 支持中间件（Express 风格，如 multer 文件上传）：
 *   route.post('/upload', upload.single('file'), async (body, req, res) => {
 *       // req.file 由 multer 解析后注入（body 不含文件，文件在 req.file）
 *       return { code: 0, message: '上传成功', data: { filename: req.file.filename } }
 *   })
 *   route.post('/upload', [auth, upload.array('files', 5)], async (body, req, res) => { ... })
 *
 * handler 签名：async (body, req, res) => result
 *   - body：自动合并 { params, query, body }，解构即用
 *   - req / res：原始对象（需要时可用 req.file、req.ip、res.setHeader 等）
 *   - 返回 { code, ... } 对象时原样 res.json 输出；返回普通数据自动包装为 res.success
 *   - 抛错自动进入全局错误处理
 *
 * 方法类型：route.get / route.post / route.put / route.delete / route.patch
 *   也可 route(path, handler, method)，默认 POST
 */

/** 自动注册路由注册表（模块加载时定义即注册，useServer 启动时自动收集） */
const registeredRoutes = []

const register = (route) => {
    const idx = registeredRoutes.findIndex((r) => r.method === route.method && r.path === route.path)
    if (idx >= 0) registeredRoutes[idx] = route
    else registeredRoutes.push(route)
    return route
}

/** 获取所有已注册路由（内部使用，供 useServer 启动时收集） */
export const getRegisteredRoutes = () => [...registeredRoutes]

/** 拼接路径：joinPath('/task', '/upload') => '/task/upload'；joinPath('/task', '') => '/task' */
const joinPath = (prefix, path) => {
    const p = String(prefix ?? '').replace(/\/+$/, '')
    const h = String(path ?? '').replace(/^\/+/, '')
    return h ? `${p}/${h}` : p
}

/**
 * 解析参数：route(path, [middlewares...,] handler[, method])
 * 兼容：route(path, handler, method)
 */
const resolveArgs = (...args) => {
    let method = null
    // 末尾若为合法方法字符串，视为 method（兼容 route(path, handler, method)）
    if (typeof args[args.length - 1] === 'string' && ['get', 'post', 'put', 'delete', 'patch'].includes(args[args.length - 1].toLowerCase())) {
        method = args.pop()
    }
    const handler = args.pop()
    // 中间件：单个函数或数组（数组展开），handler 之前的参数
    const middlewares = Array.isArray(args[0]) ? args[0] : args
    return { middlewares, handler, method }
}

const createRoute = (path, middlewares, handler, method) => {
    const item = {
        method,
        path,
        handler: async (req, res, next) => {
            try {
                // 先执行引用者中间件（Express 风格 (req, res, next)，如 multer 的 upload.single('file')）
                for (const mw of middlewares) {
                    await new Promise((resolve, reject) => {
                        mw(req, res, (err) => (err ? reject(err) : resolve()))
                    })
                }
                const body = { ...req.params, ...req.query, ...req.body }
                const result = await handler(body, req, res)
                if (!res.headersSent) {
                    if (result && typeof result === 'object' && 'code' in result) {
                        res.json(result)
                    } else {
                        res.success(result === undefined ? null : result)
                    }
                }
            } catch (err) {
                next(err)
            }
        }
    }
    return register(item)
}

/**
 * 定义并自动注册一个路由
 * @param {string} path 路由路径，如 '/test'
 * @param {function|function[]} handlerOrMws 处理函数 async (body, req, res) => result；
 *        也可先传中间件（单个或数组，如 multer 的 upload.single('file')），最后一个参数为处理函数
 * @param {string} [method='post'] HTTP 方法：get | post | put | delete | patch
 * @returns {{method:string,path:string,handler:function}} 路由配置
 */
const route = (path, ...args) => {
    const { middlewares, handler, method } = resolveArgs(...args)
    return createRoute(path, middlewares, handler, method || 'post')
}

// 方法类型便捷写法（IDE 自动补全友好）
route.get = (path, ...args) => {
    const { middlewares, handler } = resolveArgs(...args)
    return createRoute(path, middlewares, handler, 'get')
}
route.post = (path, ...args) => {
    const { middlewares, handler } = resolveArgs(...args)
    return createRoute(path, middlewares, handler, 'post')
}
route.put = (path, ...args) => {
    const { middlewares, handler } = resolveArgs(...args)
    return createRoute(path, middlewares, handler, 'put')
}
route.delete = (path, ...args) => {
    const { middlewares, handler } = resolveArgs(...args)
    return createRoute(path, middlewares, handler, 'delete')
}
route.patch = (path, ...args) => {
    const { middlewares, handler } = resolveArgs(...args)
    return createRoute(path, middlewares, handler, 'patch')
}

/**
 * 分组前缀路由：返回带 get/post/put/delete/patch 的子路由，路径自动拼接前缀
 * 用法：
 *   const api = route.parentRoute('/task')
 *   api.post('/upload', upload.single('file'), handler)   // POST /task/upload
 *   api.get('/list', handler)                              // GET /task/list
 *   api.parentRoute('/:id').get('/info', handler)          // 支持嵌套，GET /task/:id/info
 * @param {string} [prefix=''] 路径前缀，如 '/task'
 * @returns {{get:function,post:function,put:function,delete:function,patch:function,parentRoute:function}}
 */
route.parentRoute = (prefix = '') => {
    const api = {}
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
        api[method] = (path, ...args) => {
            const { middlewares, handler } = resolveArgs(...args)
            return createRoute(joinPath(prefix, path), middlewares, handler, method)
        }
    }
    // 嵌套分组：api.parentRoute('/:id').get(...)
    api.parentRoute = (sub = '') => route.parentRoute(joinPath(prefix, sub))
    return api
}

export default route
