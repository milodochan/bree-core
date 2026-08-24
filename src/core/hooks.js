/**
 * 公用钩子注册表（单一存储，跨模块共享）
 *
 * 在应用入口（如 app.js）中赋值配置，useHandler / scheduler 等模块自动生效。
 * 后续新增钩子只需在此扩展字段。
 *
 * - registerError(db, obj)     任务失败回写（useHandler / scheduler 使用），obj: { id, ResultStatus: 1, ErrorMessage }
 * - registerComplete(db, obj)  任务成功回写（useHandler 使用），obj: { id, ResultStatus: 0, ExecuteResult }
 * - registerLoader(db, obj)    任务列表加载（scheduler 使用），返回值作为任务列表
 * - registerCreate(db, obj)    任务创建状态回写（scheduler 使用），obj: { id }
 */
export const hooks = {
    registerError: null,
    registerComplete: null
}

export default hooks
