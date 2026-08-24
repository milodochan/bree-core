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
 * handler 签名：async (body, req, res) => result
 *   - body：自动合并 { params, query, body }，解构即用
 *   - req / res：原始对象（需要时可用 req.ip、res.setHeader 等）
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

const createRoute = (path, handler, method) => {
    const item = {
        method,
        path,
        handler: async (req, res, next) => {
            try {
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
 * @param {function} handler 处理函数：async (body, req, res) => result
 * @param {string} [method='post'] HTTP 方法：get | post | put | delete | patch
 * @returns {{method:string,path:string,handler:function}} 路由配置
 */
const route = (path, handler, method = 'post') => createRoute(path, handler, method)

// 方法类型便捷写法（IDE 自动补全友好）
route.get = (path, handler) => createRoute(path, handler, 'get')
route.post = (path, handler) => createRoute(path, handler, 'post')
route.put = (path, handler) => createRoute(path, handler, 'put')
route.delete = (path, handler) => createRoute(path, handler, 'delete')
route.patch = (path, handler) => createRoute(path, handler, 'patch')

export default route
