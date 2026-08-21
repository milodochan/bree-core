import ExcelJS from 'exceljs'
import path from 'node:path'
import fs from 'node:fs/promises'

let baseFolder = null

/**
 * 内部：构建 sheet columns:[{ header: 'ID', key: 'id', width: 10 }]
 */
const buildSheet = (workbook, columns, data) => {
    const sheet = workbook.addWorksheet('sheet1')
    sheet.columns = columns
    for (const item of data) {
        sheet.addRow(item)
    }
    return sheet
}

/**
 * 文件
 * @param {*} fileName 
 * @param {*} folder 
 * @returns 
 */
const getFilePath = async (fileName) => {
    const baseDir = baseFolder
        ? path.resolve(process.cwd(), baseFolder)
        : process.cwd()

    await fs.mkdir(baseDir, { recursive: true })

    const name = fileName.endsWith('.xlsx')
        ? fileName
        : `${fileName}.xlsx`

    return path.join(baseDir, name)
}

/**
 * 设置基础目录
 * @param {*} folder 
 */
const setFolder = (folder) => {
    baseFolder = folder
}

/**
 * 小/中数据：生成 Excel 文件（落盘）
 * 适合：< 5w 行
 */
const createExcel = async (columns, data, fileName = 'report') => {
    const workbook = new ExcelJS.Workbook()
    buildSheet(workbook, columns, data)
    const filePath = await getFilePath(fileName)
    await workbook.xlsx.writeFile(filePath)
    return filePath
}

/**
 * 邮件专用：生成 Buffer（不落盘）
 * 适合：中小数据
 */
const createBufferExcel = async (columns, data) => {
    const workbook = new ExcelJS.Workbook()
    buildSheet(workbook, columns, data)
    return await workbook.xlsx.writeBuffer()
}

/**
 * 大数据（核心优化）：流式写入（不爆内存）
 * 适合：10w ~ 100w+
 */
let streamWorkbook = null
let streamSheet = null
const createStreamExcel = async (columns, data, fileName = 'report', lastWrite = false) => {
    const filePath = await getFilePath(fileName)
    if (!streamWorkbook) {
        streamWorkbook = new ExcelJS.stream.xlsx.WorkbookWriter({
            filename: filePath,
            useStyles: false,
            useSharedStrings: true
        })

        streamSheet = workbook.addWorksheet('Report')
        streamSheet.columns = columns
    }
    for (const item of data) {
        streamSheet.addRow(item).commit()
    }

    if (lastWrite) {
        await workbook.commit()
        streamWorkbook = null
        streamSheet = null
    }
    return filePath
}

/**
 * 🚀 统一入口（推荐用这个）
 */
const exportExcel = async ({
    mode = 'file', // file | buffer | stream
    columns,
    data,
    fileName = 'report'
}) => {
    switch (mode) {
        case 'buffer':
            return await createBufferExcel(columns, data)
        case 'stream':
            return await createStreamExcel(columns, data, fileName, true)
        default:
            return await createExcel(columns, data, fileName)
    }
}

export default {
    setFolder,
    getFilePath,
    exportExcel,
    createExcel,
    createBufferExcel,
    createStreamExcel
}