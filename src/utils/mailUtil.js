import nodemailer from 'nodemailer'
import path from 'node:path'

let transporter = null
let from = ''
const init = () => {
    from = `"${process.env.MAIL_USERNAME}" <${process.env.MAIL_ACCOUNT}>`
    transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST, // 或公司邮箱 SMTP
        port: Number(process.env.MAIL_PORT),
        secure: true,
        auth: {
            user: process.env.MAIL_ACCOUNT,
            pass: process.env.MAIL_PASSWORD // 注意不是密码
        }
    })
}

const send = async (subject, toUser = '', copyUser = '', content = '', filePath = []) => {
    await transporter.sendMail({
        from: from,
        to: toUser.split(',').map(i => i.trim()).filter(Boolean),
        cc: copyUser.split(',').map(i => i.trim()).filter(Boolean),
        subject: subject,
        text: content,
        attachments: filePath.map(file => {
            const filename = path.basename(file) // ⭐ 核心：自动截取文件名
            return {
                path: file,
                filename
            }
        })
    })
}

export default {
    init,
    send
}