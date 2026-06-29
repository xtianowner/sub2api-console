/**
 * 稳健探活 + 真实额度。直连 ChatGPT 后端精确探每个号(用实时回源的 access_token，绕开 sub2api 分组调度)。移植自 prober.py。
 * chatgpt-account-id 优先用库里的，否则从 id_token(JWT) 解 org id；判活以 codex 端点为准
 * (accounts/check 常被 Cloudflare 403，不作 auth_fail 依据，避免误删活号)。
 */
import https from 'node:https'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { PROBE_MODEL } from './config.js'
import type { TokenRow } from './sourceTokens.js'

const ACCOUNTS_CHECK_URL = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27'
const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses'
const DEFAULT_UA = 'Mozilla/5.0'

// openai 出口代理：国内机直连不通 chatgpt.com → 经 CONSOLE_PROBE_PROXY(socks5h://...) 出墙。空=直连。
const PROBE_PROXY = process.env.CONSOLE_PROBE_PROXY || ''
const proxyAgent = PROBE_PROXY ? new SocksProxyAgent(PROBE_PROXY) : undefined

interface HttpResult { status: number; headers: Record<string, string>; text: string }

function http(method: string, url: string, headers: Record<string, string>, body?: string, timeoutMs = 40000): Promise<HttpResult> {
  return new Promise((resolve) => {
    const req = https.request(url, { method, headers, agent: proxyAgent, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c as Buffer))
      res.on('end', () => {
        const h: Record<string, string> = {}
        for (const [k, v] of Object.entries(res.headers)) h[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v ?? '')
        resolve({ status: res.statusCode || 0, headers: h, text: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', (e) => resolve({ status: 0, headers: {}, text: `__exc__:${e.message}` }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, text: '__exc__:timeout' }) })
    if (body) req.write(body)
    req.end()
  })
}

interface AccountsCheck { http_status: number; account_id: string | null; plan_type: string | null; is_deactivated: boolean | null }
async function accountsCheck(accessToken: string, ua?: string | null): Promise<AccountsCheck> {
  const r = await http('GET', ACCOUNTS_CHECK_URL, {
    Authorization: `Bearer ${accessToken}`, 'User-Agent': ua || DEFAULT_UA,
    Origin: 'https://chatgpt.com', Referer: 'https://chatgpt.com/',
  }, undefined, 25000)
  const out: AccountsCheck = { http_status: r.status, account_id: null, plan_type: null, is_deactivated: null }
  if (r.status === 200) {
    try {
      const d = JSON.parse(r.text)
      const first = Object.values((d.accounts || {}) as Record<string, any>)[0] as any
      const acc = (first || {}).account || {}
      out.account_id = acc.account_id ?? null
      out.plan_type = acc.plan_type ?? null
      out.is_deactivated = acc.is_deactivated ?? null
    } catch { /* ignore */ }
  }
  return out
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseCodexHeaders(h: Record<string, string>) {
  return {
    plan_type: h['x-codex-plan-type'] ?? null,
    active_limit: h['x-codex-active-limit'] ?? null,
    primary_used_percent: num(h['x-codex-primary-used-percent']),
    secondary_used_percent: num(h['x-codex-secondary-used-percent']),
    primary_window_minutes: num(h['x-codex-primary-window-minutes']),
    secondary_window_minutes: num(h['x-codex-secondary-window-minutes']),
    primary_reset_after_seconds: num(h['x-codex-primary-reset-after-seconds']),
    primary_reset_at: num(h['x-codex-primary-reset-at']),
    secondary_reset_at: num(h['x-codex-secondary-reset-at']),
    credits_balance: h['x-codex-credits-balance'] ?? null,
  }
}

async function codexProbeDirect(accessToken: string, accountId: string | null, ua?: string | null, model?: string) {
  const body = JSON.stringify({
    model: model || PROBE_MODEL, instructions: 't',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    stream: true, store: false,
  })
  const r = await http('POST', CODEX_URL, {
    Authorization: `Bearer ${accessToken}`, 'chatgpt-account-id': accountId || '',
    'OpenAI-Beta': 'responses=experimental', originator: 'codex_cli_rs',
    'User-Agent': ua || DEFAULT_UA, 'Content-Type': 'application/json',
  }, body, 45000)
  const out: any = {
    http_status: r.status,
    usage: r.status === 200 ? parseCodexHeaders(r.headers) : {},
    completed: r.text.includes('response.completed'),
    not_supported: r.text.includes('not supported when using Codex'),
    body_head: r.text.slice(0, 200),
  }
  if (r.status === 429) {
    try {
      const err = (JSON.parse(r.text).error) || {}
      out.plan_type = err.plan_type
      out.resets_at = err.resets_at
    } catch { /* ignore */ }
  }
  return out
}

function classify(check: AccountsCheck, probe: any): string {
  if (check.is_deactivated === true) return 'dead'
  const st = probe.http_status
  if (st === 200 && probe.completed) return 'alive'
  if (st === 429) return 'rate_limited'
  if (probe.not_supported) return 'no_codex_perm'
  if (st === 401 || st === 403) return 'auth_fail'
  return 'transient'
}

function accountIdFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null
  try {
    let p = idToken.split('.')[1]
    p += '='.repeat((-p.length % 4 + 4) % 4)
    const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    const orgs = (c['https://api.openai.com/auth'] || {}).organizations || []
    for (const o of orgs) if (o.is_default) return o.id
    return orgs.length ? orgs[0].id : null
  } catch { return null }
}

export interface ProbeResult {
  sub2_account_id: number; cpa_email: string | null; verdict: string | null
  plan_type: string | null; is_deactivated: boolean | null
  // codex 限流窗口：primary=5h、secondary=7d(周)。字段名按真实窗口命名，避免再被写反。
  used_5h_percent: number | null; used_7d_percent: number | null
  primary_reset_after_seconds: number | null; primary_reset_at: number | null
  secondary_reset_at: number | null; primary_window_minutes: number | null
  check_status: number | null; probe_status: number | string | null
}

export async function probeOne(tokenRow: TokenRow, model?: string): Promise<ProbeResult> {
  const at = tokenRow.access_token
  const base: ProbeResult = {
    sub2_account_id: tokenRow.sub2_account_id, cpa_email: tokenRow.cpa_email || null, verdict: null,
    plan_type: null, is_deactivated: null, used_5h_percent: null, used_7d_percent: null,
    primary_reset_after_seconds: null, primary_reset_at: null, secondary_reset_at: null,
    primary_window_minutes: null, check_status: null, probe_status: null,
  }
  if (!at) return base
  const ua = tokenRow.ua
  let acct = tokenRow.chatgpt_account_id || accountIdFromIdToken(tokenRow.id_token)
  const chk = await accountsCheck(at, ua)
  if (!acct) acct = chk.account_id
  const prb = acct
    ? await codexProbeDirect(at, acct, ua, model)
    : { http_status: chk.http_status, usage: {}, completed: false, not_supported: false, body_head: '' }
  const u = prb.usage || {}
  return {
    sub2_account_id: tokenRow.sub2_account_id,
    cpa_email: tokenRow.cpa_email || null,
    verdict: classify(chk, prb),
    plan_type: chk.plan_type || u.plan_type || prb.plan_type || null,
    is_deactivated: chk.is_deactivated,
    used_5h_percent: u.primary_used_percent ?? null,      // 5h = primary window
    used_7d_percent: u.secondary_used_percent ?? null,    // 7d = secondary(weekly) window
    primary_reset_after_seconds: u.primary_reset_after_seconds ?? prb.resets_at ?? null,
    primary_reset_at: u.primary_reset_at ?? prb.resets_at ?? null,   // 5h 重置
    secondary_reset_at: u.secondary_reset_at ?? null,               // 7d 重置
    primary_window_minutes: u.primary_window_minutes ?? null,
    check_status: chk.http_status,
    probe_status: prb.http_status,
  }
}
