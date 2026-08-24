import express from 'express'
import { readdir } from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { createLogger } from '../config/createLogger.js'
import { auth } from './auth.js'
import { getRegisteredRoutes } from './route.js'

/**
 * 递归扫描目录下所有 JS 文件并动态加载（触发 route() 自动注册）
 * 跳过以 . / _ 开头的文件（如 .DS_Store、_private.js）
 */
const loadRouteFiles = async (dirs, logger) => {
    const list = Array.isArray(dirs) ? dirs : [dirs]
    let total = 0

    for (const dir of list) {
        const abs = path.resolve(dir)
        let entries
        try {
            entries = await readdir(abs, { withFileTypes: true })
        } catch {
            continue // 目录不存在则跳过
        }

        const walk = async (items, base) => {
            for (const item of items) {
                if (item.name.startsWith('.') || item.name.startsWith('_')) continue
                const full = path.join(base, item.name)
                if (item.isDirectory()) {
                    await walk(await readdir(full, { withFileTypes: true }), full)
                } else if (/\.(mjs|cjs|js)$/i.test(item.name)) {
                    try {
                        await import(pathToFileURL(full).href)
                        total += 1
                    } catch (err) {
                        logger?.error?.(`load routes file failed: ${full} - ${err?.message || err}`)
                    }
                }
            }
        }
        await walk(entries, abs)
    }

    if (total > 0) logger?.info?.(`auto-loaded ${total} routes file(s)`)
}

/**
 * CORS 中间件（不引入额外依赖）
 */
const createCors = (options = {}) => {
    const opts = typeof options === 'string' ? { origin: options } : options
    const origin = opts.origin ?? '*'
    const methods = opts.methods || 'GET,POST,PUT,DELETE,PATCH,OPTIONS'
    const headers = opts.headers || 'Content-Type,Authorization,x-api-key'

    return (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Methods', methods)
        res.setHeader('Access-Control-Allow-Headers', headers)
        if (req.method === 'OPTIONS') return res.sendStatus(204)
        next()
    }
}

/**
 * Express 服务封装
 * @param {object} options
 * @param {number} [options.port=3000]        监听端口
 * @param {string} [options.host='0.0.0.0']   监听地址
 * @param {object} [options.logger]           自定义 logger（默认 createLogger({ name: 'server', split: true })）
 * @param {string} [options.jsonLimit='10mb']  JSON body 大小限制
 * @param {string} [options.urlencodedLimit='10mb']  urlencoded body 大小限制
 * @param {boolean|string|object} [options.cors=true] 是否启用 CORS；可传 origin 字符串或 { origin, methods, headers }
 * @param {string|string[]} [options.staticDir=null]  静态资源目录（可传数组），相对 cwd 或绝对路径
 * @param {boolean|function|function[]} [options.auth=false]  认证中间件：
 *        true 使用内置 auth（依赖 API_SECRET_KEY/API_TOKEN/ALLOW_IPS 环境变量）；
 *        传函数或函数数组则使用外部自定义中间件（如 (req, res, next) => {...}）；false 不启用
 * @param {boolean} [options.health=true]     是否启用 GET /health 健康检查
 * @param {boolean} [options.trustProxy=true] 是否信任代理（影响 req.ip）
 * @param {function|Array<{method:string,path:string,handler:function|function[]}>} [options.routes=null]
 *        路由注册：函数 (app) => {...} 或路由配置数组；也可省略，用 route() 定义即自动注册
 * @param {string|string[]|false} [options.routesDir='routes'] 路由文件目录（相对 cwd 或绝对路径），
 *        start() 时自动递归扫描并加载其中所有 JS 文件（触发 route() 自动注册），无需手动 import；
 *        传 false 关闭扫描；可传数组扫描多个目录
 * @returns {{ app, start, stop, getServer }}
 */
export function useServer(options = {}) {
    const {
        port = 3000,
        host = '0.0.0.0',
        logger = createLogger({ name: 'server', split: true }),
        jsonLimit = '10mb',
        urlencodedLimit = '10mb',
        cors = true,
        staticDir = null,
        auth: enableAuth = false,
        health = true,
        trustProxy = true,
        routes = null,
        routesDir = 'routes'
    } = options

    const app = express()

    if (trustProxy) app.set('trust proxy', true)

    // body 解析
    app.use(express.json({ limit: jsonLimit }))
    app.use(express.urlencoded({ extended: true, limit: urlencodedLimit }))

    // 请求日志（含耗时/状态码/IP）
    app.use((req, res, next) => {
        const start = Date.now()
        res.on('finish', () => {
            const duration = Date.now() - start
            logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms ${req.ip || ''}`)
        })
        next()
    })

    // CORS
    if (cors) app.use(createCors(cors))

    // 统一响应格式 res.success / res.fail
    app.use((req, res, next) => {
        res.success = (data = null, message = 'ok') => {
            res.json({ code: 0, message, data })
        }
        res.fail = (message = 'error', code = -1) => {
            res.json({ code, message, data: null })
        }
        next()
    })

    // 静态资源
    if (staticDir) {
        const dirs = Array.isArray(staticDir) ? staticDir : [staticDir]
        for (const dir of dirs) {
            app.use(express.static(dir))
        }
    }

    // 认证（true 用内置 auth；函数/数组用外部自定义中间件）
    if (enableAuth) {
        if (typeof enableAuth === 'function') {
            app.use(enableAuth)
        } else if (Array.isArray(enableAuth)) {
            app.use(...enableAuth)
        } else {
            app.use(auth)
        }
    }

    // 健康检查
    if (health) {
        app.get('/health', (req, res) => {
            res.success({ status: 'ok', uptime: process.uptime() })
        })
    }

    // 路由注册 + 404 + 错误处理
    // 需在 routesDir 扫描加载（触发 route() 自动注册）之后执行，故封装为函数由 start() 调用
    const setupRoutes = () => {
        // 业务路由（routes 为函数时保留原逻辑：完全自控注册顺序）
        if (typeof routes === 'function') {
            routes(app)
        }

        // 路由配置：手动传入的 routes + route() 自动注册的路由
        // 定义即自动注册，无需在 app.js 中重复传递
        const allRoutes = [
            ...(Array.isArray(routes) ? routes : []),
            ...getRegisteredRoutes()
        ]

        // 静态路径优先注册，避免被动态参数路由（如 /:id）吞掉
        allRoutes.sort((a, b) => {
            const dynamic = (r) => (r.path || '').split('/').filter((s) => s.startsWith(':')).length
            return dynamic(a) - dynamic(b)
        })

        for (const route of allRoutes) {
            const { method, path: routePath, handler } = route
            const fn = app[method?.toLowerCase()]
            if (typeof fn === 'function' && routePath && handler) {
                fn.call(app, routePath, handler)
            }
        }

        // 404
        app.use((req, res) => {
            res.status(404).fail('Not Found', 404)
        })

        // 全局错误处理（express 5 自动捕获 async 异常）
        app.use((err, req, res, next) => {
            logger.error(`${req.method} ${req.originalUrl} - ${err?.stack || err?.message || err}`)
            if (res.headersSent) return next(err)

            const status = err?.status || err?.statusCode || 500
            res.status(status).fail(err?.message || 'Internal Server Error', status)
        })
    }

    // 启动/停止控制
    let server = null

    const start = async () => {
        // 自动扫描加载路由文件（触发 route() 自动注册）
        if (routesDir) await loadRouteFiles(routesDir, logger)

        // 路由注册 + 404 + 错误处理（在扫描之后执行）
        setupRoutes()

        return new Promise((resolve, reject) => {
            server = app.listen(port, host, () => {
                logger.info(`Server listening on http://${host}:${port}`)
                resolve(server)
            })
            server.on('error', (err) => {
                logger.error(`Server error: ${err?.message}`)
                reject(err)
            })
        })
    }

    const stop = () => {
        return new Promise((resolve) => {
            if (!server) return resolve()
            server.close(() => resolve())
        })
    }

    return {
        app,
        start,
        stop,
        getServer: () => server
    }
}
