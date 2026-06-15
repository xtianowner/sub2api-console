/**
 * 统一密码门禁：登录校验密码 → 发 httpOnly 签名会话 cookie；中间件保护所有写/危险路由。
 * 会话无状态(HMAC 签名，含过期)，重启不失效；密码只存哈希(config)。
 */
import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { hasAdminPassword, sessionSecret, setAdminPassword, verifyAdminPassword } from './config.js'

const COOKIE = 'console_session'
const TTL_MS = 7 * 24 * 3600 * 1000

function sign(payload: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
}

export function makeSession(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL_MS })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  const expect = sign(payload)
  const a = Buffer.from(sig); const b = Buffer.from(expect)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now() } catch { return false }
}

function getCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export function isAuthed(req: Request): boolean {
  return verifySession(getCookie(req, COOKIE))
}

export function login(req: Request, res: Response): void {
  if (!hasAdminPassword()) { res.status(409).json({ error: '尚未设置管理员密码，请在部署目录 .env 配置 CONSOLE_ADMIN_PASSWORD 后重启', need_setup: true }); return }
  const pw = String((req.body || {}).password || '')
  if (!verifyAdminPassword(pw)) { res.status(401).json({ error: '密码错误' }); return }
  const secure = req.protocol === 'https'
  res.setHeader('Set-Cookie', `${COOKIE}=${makeSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL_MS / 1000}${secure ? '; Secure' : ''}`)
  res.json({ ok: true })
}

/** 改管理员密码（需已登录；已设密码则校验原密码）。 */
export function changePassword(req: Request, res: Response): void {
  const { old_password, new_password } = (req.body || {}) as { old_password?: string; new_password?: string }
  if (!new_password || String(new_password).length < 6) { res.status(400).json({ error: '新密码至少 6 位' }); return }
  if (hasAdminPassword() && !verifyAdminPassword(String(old_password || ''))) { res.status(401).json({ error: '原密码错误' }); return }
  setAdminPassword(String(new_password))
  res.json({ ok: true })
}

export function logout(_req: Request, res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
  res.json({ ok: true })
}

/** 中间件：保护写/危险路由。未登录 → 401。 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthed(req)) return next()
  res.status(401).json({ error: 'unauthorized', need_login: true })
}
