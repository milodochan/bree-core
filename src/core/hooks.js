
let registerError = null
let registerComplete = null
let registerLoader = null

/** 每个钩子未注册时只提示一次，避免刷屏 */
const warnOnce = (() => {
    const warned = new Set()
    return (name) => {
        if (warned.has(name)) return
        warned.add(name)
        console.warn(
            `[bree-core] hooks.${name} 未注册，任务状态不会回写数据库。` +
            `可直接赋值 hooks.${name} = async (db, obj) => { /* 回写逻辑 */ } 注册。`
        )
    }
})()

// 默认空实现：不注册不崩溃，只提示一次
registerError = async () => warnOnce('registerError')
registerComplete = async () => warnOnce('registerComplete')
registerLoader = async () => {
    warnOnce('registerLoader')
    return []
}

export default {
    registerLoader,
    registerError,
    registerComplete
}
