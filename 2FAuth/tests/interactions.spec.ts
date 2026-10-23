import { test, expect, type Page } from '@playwright/test'

async function fixture(page: Page, setup = false) {
  await page.addInitScript(({ setup }) => {
    const account = (id: string, issuer: string, group: string, color: string, favorite = false) => ({ id, issuer, account: `${id}@example.com`, group, color, favorite, algorithm: 'SHA1', digits: 6, period: 30, notes: '', recoveryTotal: id === 'alice' ? 4 : 0, recoveryRemaining: id === 'alice' ? 3 : 0 })
    const state = { dataDir: setup ? null : 'B:\\Fixtures\\2FAuth', startupError: null, accounts: setup ? [] : [account('alice', 'GitHub', '个人', '#A7B8EF', true), account('work', 'GitHub', '工作', '#86CDB7'), account('google', 'Google', '个人', '#DDB18D'), account('gitlab', 'GitLab', '工作', '#C7A4DE'), account('microsoft', 'Microsoft', '个人', '#86C6DC')] }
    const recovery = [{ id: 'r1', code: 'recovery-001', used: false }, { id: 'r2', code: 'recovery-002', used: false }, { id: 'r3', code: 'recovery-003', used: false }, { id: 'r4', code: 'recovery-004', used: true }]
    const controls = { calls: [] as { cmd: string; args: any }[], failDirectory: false, failCode: false, nextCode: '123456', folder: 'B:\\Fixtures\\New', importFile: 'B:\\Fixtures\\backup.json', savedSecret: '', delayRecovery: 0 }
    const time = { enabled: false, syncing: false, source: 'local', offsetMs: 0, uncertaintyMs: null as number | null, lastSuccessAt: null as number | null, validUntil: null as number | null, providers: [] as string[], error: null as string | null, revision: 0 }
    const timeControls = { time, failTime: false, timeOffset: 90000, timeDelay: 60 }
    Object.assign(controls, timeControls)
    const startSync = () => {
      time.syncing = true; time.revision++
      const revision = time.revision
      window.setTimeout(() => {
        if (!time.enabled || time.revision !== revision) return
        time.syncing = false; time.revision++
        if ((controls as any).failTime) time.error = '时间来源请求超时'
        else Object.assign(time, { source: 'network', offsetMs: (controls as any).timeOffset, uncertaintyMs: 700, lastSuccessAt: Date.now(), validUntil: Date.now() + 3600000, providers: ['Cloudflare', 'Microsoft'], error: null })
      }, (controls as any).timeDelay)
    }
    ;(window as any).__fixture = controls
    ;(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any = {}) => {
      controls.calls.push({ cmd, args })
      if (cmd === 'get_state') return structuredClone(state)
      if (cmd === 'get_time_status') return structuredClone(time)
      if (cmd === 'set_online_time') { Object.assign(time, { enabled: args.enabled, syncing: false, source: 'local', offsetMs: 0, uncertaintyMs: null, lastSuccessAt: null, validUntil: null, providers: [], error: null, revision: time.revision + 1 }); if (args.enabled) startSync(); return structuredClone(time) }
      if (cmd === 'sync_time') { if (!time.enabled) throw '请先开启联网校时'; if (!time.syncing) startSync(); return structuredClone(time) }
      if (cmd === 'suggest_data_dir') return 'B:\\Fixtures\\2FAuth'
      if (cmd === 'get_code') { if (controls.failCode) throw '读取认证信息失败'; const now = Date.now() + time.offsetMs; return { code: controls.nextCode, period: 30, generatedAt: now, validUntil: (Math.floor(now / 30000) + 1) * 30000, timeStatus: structuredClone(time) } }
      if (cmd === 'plugin:clipboard-manager|write_text') return
      if (cmd === 'plugin:dialog|open') return args.options?.directory ? controls.folder : controls.importFile
      if (cmd === 'plugin:dialog|save') return 'B:\\Fixtures\\export.json'
      if (cmd === 'change_data_dir') { if (controls.failDirectory) throw '请选择空目录或有效账户库'; state.dataDir = args.path; return structuredClone(state) }
      if (cmd === 'open_data_dir' || cmd === 'export_backup') return
      if (cmd === 'import_backup') return { state: structuredClone(state), added: 2, skipped: 1 }
      if (cmd === 'parse_uri') { const uri = new URL(args.uri); if (uri.host !== 'totp') throw '仅支持 TOTP 链接'; return { issuer: 'GitHub', account: 'imported@example.com', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256', digits: 8, period: 60 } }
      if (cmd === 'save_account') {
        const input = args.input; controls.savedSecret = input.secret
        const old = state.accounts.find(a => a.id === input.id)
        const next = { ...(old ?? account('new', input.issuer, input.group, input.color)), ...input, id: input.id ?? 'new' }
        if (old) Object.assign(old, next); else state.accounts.push(next)
        return { state: structuredClone(state), id: next.id }
      }
      if (cmd === 'set_favorite') { state.accounts.find(a => a.id === args.id)!.favorite = args.favorite; return structuredClone(state) }
      if (cmd === 'reveal_secret') return 'JBSWY3DPEHPK3PXP'
      if (cmd === 'get_recovery_codes') { if (controls.delayRecovery) await new Promise(resolve => setTimeout(resolve, controls.delayRecovery)); return args.id === 'alice' ? structuredClone(recovery) : [] }
      if (cmd === 'set_recovery_used') { recovery.find(c => c.id === args.codeId)!.used = args.used; state.accounts.find(a => a.id === args.id)!.recoveryRemaining = recovery.filter(c => !c.used).length; return structuredClone(state) }
      if (cmd === 'save_recovery_codes') { state.accounts.find(a => a.id === args.id)!.recoveryTotal = args.text.split('\n').filter(Boolean).length; return structuredClone(state) }
      if (cmd === 'delete_account') { state.accounts = state.accounts.filter(a => a.id !== args.id); return structuredClone(state) }
      throw `Unexpected command: ${cmd}`
    } }
  }, { setup })
  await page.goto('/')
}

test('首次连接目录，添加手动账户并切换到详情', async ({ page }) => {
  await fixture(page, true)
  await page.getByRole('button', { name: '选择数据目录' }).click()
  await expect(page.getByRole('dialog')).toContainText('明文')
  await page.getByRole('button', { name: '初始化 / 连接目录' }).click()
  await page.getByRole('button', { name: '添加第一个账户' }).click()
  await page.getByLabel('账户名称', { exact: true }).fill('new@example.com')
  await page.getByLabel('共享密钥', { exact: true }).fill('JBSWY3DPEHPK3PXP')
  await page.getByRole('button', { name: '保存账户', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择 GitHub new@example.com' })).toBeVisible()
  await expect(page.getByRole('button', { name: '点击复制验证码' })).toHaveText('123 456')
})

test('搜索、分组、收藏和当前验证码复制', async ({ page }, info) => {
  await fixture(page)
  await expect(page.getByRole('button', { name: '点击复制验证码' })).toHaveText('123 456')
  await page.screenshot({ path: info.outputPath('authenticator.png') })
  await page.getByLabel('搜索账户').fill('google')
  await expect(page.getByRole('button', { name: '选择 Google google@example.com' })).toBeVisible()
  await expect(page.getByRole('button', { name: '选择 GitHub alice@example.com' })).toHaveCount(0)
  await page.getByLabel('搜索账户').fill('')
  await page.getByLabel('筛选分组').selectOption('工作')
  await expect(page.locator('.account-row')).toHaveCount(2)
  await page.getByLabel('筛选分组').selectOption('')
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(page.locator('.account-row')).toHaveCount(1)
  await page.evaluate(() => { (window as any).__fixture.nextCode = '654321' })
  await page.getByRole('button', { name: '复制验证码', exact: true }).click()
  const copied = await page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => c.cmd === 'plugin:clipboard-manager|write_text'))
  expect(copied.at(-1).args.text).toBe('654321')
  await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '隐藏验证码' }).click()
  await expect(page.getByRole('button', { name: '点击复制验证码' })).toHaveText('••• •••')
})

test('恢复码显隐、复制与使用状态持久化', async ({ page }) => {
  await fixture(page)
  await expect(page.getByText('recovery-001', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '显示', exact: true }).click()
  await page.getByRole('button', { name: '复制恢复码 1', exact: true }).click()
  await expect(page.getByText('3 个可用 · 1 个已使用')).toBeVisible()
  await page.getByRole('button', { name: '标记已使用 1', exact: true }).click()
  await expect(page.getByText('2 个可用 · 2 个已使用')).toBeVisible()
  await expect(page.getByRole('button', { name: '复制恢复码 1', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '隐藏', exact: true }).click()
  await page.getByRole('button', { name: '显示', exact: true }).click()
  await expect(page.getByRole('button', { name: '恢复可用 1', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '管理', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('沿用其使用状态')
  await page.getByRole('button', { name: '保存恢复码' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('链接导入保留参数，编辑不回传已保存的密钥', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.getByLabel('共享密钥', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: '保存账户', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__fixture.savedSecret)).toBeNull()
  await page.getByRole('button', { name: '添加账户', exact: true }).click()
  await page.getByRole('button', { name: '链接 / 二维码' }).click()
  await page.getByLabel('认证链接', { exact: true }).fill('otpauth://totp/GitHub:imported?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60')
  await page.getByRole('button', { name: '解析认证链接' }).click()
  await expect(page.getByRole('combobox', { name: '算法', exact: true })).toHaveValue('SHA256')
  await expect(page.getByLabel('验证码位数')).toHaveValue('8')
  await expect(page.getByLabel('时间周期（秒）')).toHaveValue('60')
  await page.getByRole('button', { name: '保存账户', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择 GitHub imported@example.com' })).toBeVisible()
  await expect(page.locator('.parameter-strip')).toContainText('60 秒周期')
})

test('切换失败保留原目录，备份合并需明确确认', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '数据管理' }).click()
  await page.evaluate(() => { (window as any).__fixture.failDirectory = true })
  await page.getByRole('button', { name: '浏览', exact: true }).click()
  await page.getByRole('button', { name: '使用此目录' }).click()
  await expect(page.getByRole('alert')).toContainText('请选择空目录')
  await expect(page.locator('.storage-current')).toContainText('B:\\Fixtures\\2FAuth')
  await page.getByRole('button', { name: '导入备份', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => c.cmd === 'import_backup').length)).toBe(0)
  await page.getByRole('button', { name: '确认合并' }).click()
  await expect(page.getByRole('status')).toContainText('已导入 2 个账户，跳过 1 个重复项')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('备份已导出')
})

test('二维码图片在本地识别并填入认证表单', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '添加账户', exact: true }).click()
  await page.getByRole('button', { name: '链接 / 二维码' }).click()
  await page.locator('input[type="file"]').setInputFiles('tests/fixtures/totp.png')
  await expect(page.getByText('已读取认证信息，请核对后保存。')).toBeVisible()
  const calls = await page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => c.cmd === 'parse_uri'))
  expect(calls.at(-1).args.uri).toBe('otpauth://totp/GitHub:imported?secret=JBSWY3DPEHPK3PXP')
  await expect(page.getByLabel('共享密钥', { exact: true })).toHaveValue('JBSWY3DPEHPK3PXP')
})

test('删除确认与最小窗口布局', async ({ page }, info) => {
  await page.setViewportSize({ width: 940, height: 640 })
  await fixture(page)
  await page.getByRole('tab', { name: '账户信息' }).click()
  await page.getByRole('button', { name: '显示密钥' }).click()
  await expect(page.getByText('JBSWY3DPEHPK3PXP', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '删除账户', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('不会关闭平台上的双因素认证')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.account-row')).toHaveCount(5)
  await page.getByRole('button', { name: '删除账户', exact: true }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.locator('.account-row')).toHaveCount(4)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('minimum-window.png') })
})

test('失焦隐藏敏感信息，延迟结果不泄露到其他账户，计算失败禁用复制', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '显示', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByText('recovery-001', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { (window as any).__fixture.delayRecovery = 150 })
  await page.getByRole('button', { name: '显示', exact: true }).click()
  await page.getByRole('button', { name: '选择 Google google@example.com' }).click()
  await expect(page.getByRole('heading', { name: 'Google' })).toBeVisible()
  await expect(page.getByText('recovery-001', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { (window as any).__fixture.failCode = true })
  await expect(page.getByRole('button', { name: '复制验证码', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('读取认证信息失败')
})

test('校时默认关闭，正负时间偏差下倒计时与复制一致，关闭恢复本地时间', async ({ page }, info) => {
  await fixture(page)
  await expect(page.getByRole('button', { name: '时间校准' })).toContainText('本地时间 · 离线')
  expect(await page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => ['set_online_time', 'sync_time'].includes(c.cmd)).length)).toBe(0)
  await page.getByRole('button', { name: '时间校准' }).click()
  await expect(page.getByRole('switch', { name: '联网校时' })).not.toBeChecked()
  await expect(page.getByRole('button', { name: '立即校时' })).toBeDisabled()
  await page.getByRole('switch', { name: '联网校时' }).click()
  await expect(page.getByText('+90.000 秒', { exact: true })).toBeVisible()
  await expect(page.locator('.countdown')).toHaveText(/\d+秒/)
  await page.screenshot({ path: info.outputPath('time-settings.png') })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('button', { name: '复制验证码', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '复制验证码', exact: true }).click()
  await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
  await page.evaluate(() => { (window as any).__fixture.timeOffset = -90000 })
  await page.getByRole('button', { name: '时间校准' }).click()
  await page.getByRole('button', { name: '立即校时' }).click()
  await expect(page.getByText('-90.000 秒', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('button', { name: '点击复制验证码' })).toHaveText('123 456')
  await expect(page.getByRole('button', { name: '复制验证码', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '复制验证码', exact: true }).click()
  await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '时间校准' }).click()
  await page.getByRole('switch', { name: '联网校时' }).click()
  await expect(page.getByRole('button', { name: '时间校准' })).toContainText('本地时间 · 离线')
  await expect(page.getByText('0 秒', { exact: true })).toBeVisible()
})

test('校时失败明确回退，已有结果可继续使用，过期后恢复本地时间', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).__fixture.failTime = true })
  await page.getByRole('button', { name: '时间校准' }).click()
  await page.getByRole('switch', { name: '联网校时' }).click()
  await expect(page.locator('.time-warning')).toContainText('当前使用本地系统时间')
  await page.evaluate(() => { (window as any).__fixture.failTime = false })
  await page.getByRole('button', { name: '立即校时' }).click()
  await expect(page.getByText('+90.000 秒', { exact: true })).toBeVisible()
  await page.evaluate(() => { (window as any).__fixture.failTime = true })
  await page.getByRole('button', { name: '立即校时' }).click()
  await expect(page.locator('.time-warning')).toContainText('仍在使用有效期内的上次校正结果')
  await page.evaluate(() => { const t = (window as any).__fixture.time; Object.assign(t, { source: 'local', offsetMs: 0, validUntil: null, error: '校时结果已过期，已回退本地时间', revision: t.revision + 1 }) })
  await expect(page.getByText('0 秒', { exact: true })).toBeVisible()
  await expect(page.locator('.time-warning')).toContainText('当前使用本地系统时间')
})

test('校时请求未完成时仍可关闭开关，迟到结果不会恢复校正', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).__fixture.timeDelay = 350 })
  await page.getByRole('button', { name: '时间校准' }).click()
  await page.getByRole('switch', { name: '联网校时' }).click()
  await expect(page.getByRole('button', { name: '校时中…' })).toBeDisabled()
  await page.getByRole('switch', { name: '联网校时' }).click()
  await expect(page.getByRole('switch', { name: '联网校时' })).not.toBeChecked()
  await page.waitForTimeout(400)
  await expect(page.getByRole('button', { name: '时间校准' })).toContainText('本地时间 · 离线')
  await expect(page.getByText('0 秒', { exact: true })).toBeVisible()
})
