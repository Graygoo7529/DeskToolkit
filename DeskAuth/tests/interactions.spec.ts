import { test, expect, type Page } from '@playwright/test'

async function fixture(page: Page, setup = false) {
  await page.addInitScript(({ setup }) => {
    const contact = (value: string, label = '个人', primary = true) => ({ id: crypto.randomUUID(), value, label, primary, purposes: ['login', 'recovery'], notes: '' })
    const account = (id: string, platform: string, username: string, group: string, color: string, favorite = false) => ({ id, platform, username, group, color, favorite, website: `https://${platform.toLowerCase()}.com`, alias: group === '工作' ? '工作账户' : '个人账户', hasPassword: true, totp: null as { algorithm: string; digits: number; period: number } | null, phones: [contact('+86 138-0000-0000')], emails: [contact('alice@example.com')], tags: ['常用'], notes: '演示账户资料，仅用于测试。', createdAt: 1780272000000, updatedAt: 1780272000000, passwordUpdatedAt: 1780272000000 })
    const examples = [account('alice', 'GitHub', 'alice', '个人', '#A7B8EF', true), account('work', 'GitHub', 'alice-work', '工作', '#86CDB7'), account('google', 'Google', 'alice@example.com', '个人', '#DDB18D'), account('microsoft', 'Microsoft', 'alice-office', '工作', '#86C6DC')]
    examples[0].emails.push(contact('work@example.com', '工作', false))
    examples[1].phones = [contact('155 0000 0000', '工作')]
    examples[1].emails = [contact('work@example.com', '工作')]
    examples[2].hasPassword = false
    examples[0].totp = { algorithm: 'SHA1', digits: 6, period: 30 }
    const state = { dataDir: setup ? null : 'B:\\Fixtures\\DeskAuth' as string | null, startupError: null, accounts: setup ? [] : examples }
    const controls = { calls: [] as { cmd: string; args: any }[], clipboard: '', passwords: { alice: 'Demo! Password 中文  ', work: 'Work-demo-password', google: '', microsoft: 'Office-demo' } as Record<string, string>, failSave: false, failCopy: false, failDirectory: false, failImport: false, failDelete: false, delayPassword: 0, folder: 'B:\\Fixtures\\New', backupFolder: 'B:\\Fixtures\\Backup', state }
    const time = { enabled: false, syncing: false, source: 'local', offsetMs: 0, uncertaintyMs: null as number | null, lastSuccessAt: null as number | null, validUntil: null as number | null, providers: [] as string[], error: null as string | null, revision: 0 }
    const auth = { time, totpSecrets: { alice: 'JBSWY3DPEHPK3PXP' } as Record<string, string>, nextCode: '123456', failCode: false, failTotp: false, failTime: false, timeOffset: 90000, timeDelay: 60, codeDelay: 0, delaySecret: 0 }
    const startSync = () => {
      time.syncing = true; time.revision++; const revision = time.revision
      window.setTimeout(() => {
        if (!time.enabled || time.revision !== revision) return
        time.syncing = false; time.revision++
        if (auth.failTime) time.error = '时间来源请求超时'
        else Object.assign(time, { source: 'network', offsetMs: auth.timeOffset, uncertaintyMs: 700, lastSuccessAt: Date.now(), validUntil: Date.now() + 3600000, providers: ['Cloudflare', 'Microsoft'], error: null })
      }, auth.timeDelay)
    }
    Object.assign(controls, auth)
    ;(window as any).__fixture = controls
    ;(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any = {}) => {
      controls.calls.push({ cmd, args: structuredClone(args) })
      const clone = () => structuredClone(state)
      if (cmd === 'get_state') return clone()
      const settings = controls as typeof controls & typeof auth
      if (cmd === 'get_time_status') return structuredClone(time)
      if (cmd === 'set_online_time') { Object.assign(time, { enabled: args.enabled, syncing: false, source: 'local', offsetMs: 0, uncertaintyMs: null, lastSuccessAt: null, validUntil: null, providers: [], error: null, revision: time.revision + 1 }); if (args.enabled) { auth.failTime = settings.failTime; auth.timeOffset = settings.timeOffset; auth.timeDelay = settings.timeDelay; startSync() } return structuredClone(time) }
      if (cmd === 'sync_time') { if (!time.enabled) throw '请先开启联网校时'; if (!time.syncing) { auth.failTime = settings.failTime; auth.timeOffset = settings.timeOffset; auth.timeDelay = settings.timeDelay; startSync() } return structuredClone(time) }
      if (cmd === 'get_code') {
        if (settings.failCode) throw '读取认证器失败'
        const t = state.accounts.find(a => a.id === args.id)?.totp
        if (!t) throw '此账户尚未配置认证器'
        const now = Date.now() + time.offsetMs; const code = settings.nextCode.padStart(t.digits, '0')
        if (settings.codeDelay) await new Promise(resolve => setTimeout(resolve, settings.codeDelay))
        return { code, period: t.period, generatedAt: now, validUntil: (Math.floor(now / (t.period * 1000)) + 1) * t.period * 1000, timeStatus: structuredClone(time) }
      }
      if (cmd === 'configure_totp') {
        if (settings.failTotp) throw '认证器密钥无效，原配置已保留'
        const a = state.accounts.find(a => a.id === args.id)!
        if (args.input.secret) settings.totpSecrets[args.id] = args.input.secret
        a.totp = { algorithm: args.input.algorithm, digits: args.input.digits, period: args.input.period }; a.updatedAt = Date.now()
        return clone()
      }
      if (cmd === 'remove_totp') { const a = state.accounts.find(a => a.id === args.id)!; a.totp = null; a.updatedAt = Date.now(); return clone() }
      if (cmd === 'reveal_totp_secret') { const secret = settings.totpSecrets[args.id]; if (settings.delaySecret) await new Promise(resolve => setTimeout(resolve, settings.delaySecret)); return secret }
      if (cmd === 'copy_totp_secret') { if (controls.failCopy) throw '无法写入剪贴板，请重试'; controls.clipboard = settings.totpSecrets[args.id]; return }
      if (cmd === 'parse_uri') { const uri = new URL(args.uri); if (uri.protocol !== 'otpauth:' || uri.host !== 'totp') throw '仅支持 TOTP 链接'; return { issuer: uri.searchParams.get('issuer') || 'GitHub', account: 'imported@example.com', secret: uri.searchParams.get('secret'), algorithm: uri.searchParams.get('algorithm') || 'SHA1', digits: Number(uri.searchParams.get('digits') || 6), period: Number(uri.searchParams.get('period') || 30) } }
      if (cmd === 'suggest_data_dir') return 'B:\\Fixtures\\DeskAuth'
      if (cmd === 'plugin:dialog|open') return args.options?.title === '选择 DeskAuth 备份目录' ? controls.backupFolder : controls.folder
      if (cmd === 'change_data_dir') { if (controls.failDirectory) throw '请选择空目录或有效数据目录'; state.dataDir = args.path; state.accounts = []; return clone() }
      if (cmd === 'open_data_dir' || cmd === 'export_backup' || cmd === 'open_website') return
      if (cmd === 'import_backup') { if (controls.failImport) throw '无效的 DeskAuth 备份目录'; return { state: clone(), added: 2, skipped: 1 } }
      if (cmd === 'reveal_password') { const password = controls.passwords[args.id]; if (controls.delayPassword) await new Promise(resolve => setTimeout(resolve, controls.delayPassword)); return password }
      if (cmd === 'copy_password') { if (controls.failCopy) throw '无法写入剪贴板，请重试'; controls.clipboard = controls.passwords[args.id]; return }
      if (cmd === 'plugin:clipboard-manager|write_text') { controls.clipboard = args.text; return }
      if (cmd === 'save_account') {
        if (controls.failSave) throw '保存失败，原数据已保留'
        const input = args.input; const old = state.accounts.find(a => a.id === input.id)
        const id = input.id ?? crypto.randomUUID()
        if (input.password !== null) controls.passwords[id] = input.password
        const { password: _password, ...safe } = input
        const next = { ...(old ?? account(id, input.platform, input.username, input.group, input.color)), ...safe, id, hasPassword: !!controls.passwords[id], updatedAt: Date.now() }
        if (old) Object.assign(old, next); else state.accounts.push(next)
        return { state: clone(), id }
      }
      if (cmd === 'set_favorite') { const a = state.accounts.find(a => a.id === args.id)!; a.favorite = args.favorite; a.updatedAt = Date.now(); return clone() }
      if (cmd === 'delete_account') { if (controls.failDelete) throw '文件已被外部修改'; state.accounts = state.accounts.filter(a => a.id !== args.id); return clone() }
      throw `Unexpected command: ${cmd}`
    } }
  }, { setup })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '数据管理', exact: true })).toBeEnabled()
}
const rows = (page: Page) => page.locator('.account-select')
const calls = (page: Page, cmd: string) => page.evaluate(cmd => (window as any).__fixture.calls.filter((c: any) => c.cmd === cmd), cmd)
const clipboard = (page: Page) => page.evaluate(() => (window as any).__fixture.clipboard)

test('首次选择目录，添加账户和多个联系方式，原样保存密码', async ({ page }) => {
  await fixture(page, true)
  await page.getByRole('button', { name: '选择数据目录', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('明文 JSON')
  await page.getByRole('button', { name: '初始化 / 连接目录' }).click()
  await page.getByRole('button', { name: '添加第一个账户' }).click()
  const form = page.getByRole('dialog')
  await form.getByRole('button', { name: 'GitHub', exact: true }).click()
  await form.getByLabel('用户名', { exact: false }).fill('new-user')
  await form.getByLabel('新密码', { exact: true }).fill('  new-pass 中文  ')
  await form.getByRole('button', { name: '添加手机号', exact: true }).click()
  await form.getByLabel('手机号 1', { exact: true }).fill('+86 138 0000 0000')
  await form.getByRole('button', { name: '添加手机号', exact: true }).click()
  await form.getByLabel('手机号 2', { exact: true }).fill('15500000000')
  await form.getByLabel('主要手机号').nth(1).check()
  await expect(form.getByLabel('主要手机号').nth(0)).not.toBeChecked()
  await form.getByRole('button', { name: '添加邮箱', exact: true }).click()
  await form.getByLabel('邮箱 1', { exact: true }).fill('new@example.com')
  await form.getByRole('button', { name: '保存账户', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(1)
  const input = (await calls(page, 'save_account'))[0].args.input
  expect(input.password).toBe('  new-pass 中文  '); expect(input.phones).toHaveLength(2); expect(input.emails).toHaveLength(1)
  await page.getByRole('button', { name: '复制密码', exact: true }).click()
  expect(await clipboard(page)).toBe('  new-pass 中文  ')
})

test('平台与关键词组合检索，分组、收藏与重置', async ({ page }) => {
  await fixture(page)
  await expect(rows(page)).toHaveCount(4)
  await page.getByLabel('检索平台', { exact: true }).fill('github')
  await expect(rows(page)).toHaveCount(2)
  await page.getByLabel('搜索账户', { exact: true }).fill('work@example.com')
  await expect(rows(page)).toHaveCount(2)
  await page.getByLabel('筛选分组').selectOption('工作')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page)).toContainText('alice-work')
  await page.getByRole('button', { name: '重置筛选' }).click()
  await page.getByLabel('搜索账户', { exact: true }).fill('13800000000')
  await expect(rows(page)).toHaveCount(3)
  await page.getByLabel('检索平台', { exact: true }).fill('not-found')
  await expect(page.getByText('没有匹配的账户', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(rows(page)).toHaveCount(1)
  await page.getByRole('button', { name: '取消收藏', exact: true }).click()
  await expect(rows(page)).toHaveCount(0)
  await page.getByRole('button', { name: '重置筛选' }).click()
  await page.keyboard.press('Control+k')
  await expect(page.getByLabel('搜索账户', { exact: true })).toBeFocused()
})

test('快速复制无需显示密码，用户名和联系方式复制正确', async ({ page }) => {
  await fixture(page)
  await expect(page.getByTestId('password-value')).toHaveText('••••••••••••')
  await page.getByRole('button', { name: '快速复制密码 GitHub alice 个人账户', exact: true }).click()
  expect(await clipboard(page)).toBe('Demo! Password 中文  ')
  expect(await calls(page, 'reveal_password')).toHaveLength(0)
  await page.getByRole('button', { name: '复制密码', exact: true }).click()
  await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '复制用户名', exact: true }).click()
  expect(await clipboard(page)).toBe('alice')
  await page.getByRole('button', { name: '复制邮箱 2', exact: true }).click()
  expect(await clipboard(page)).toBe('work@example.com')
  await page.getByRole('button', { name: '平台主页', exact: true }).click()
  expect((await calls(page, 'open_website'))[0].args.id).toBe('alice')
  await page.evaluate(() => { (window as any).__fixture.failCopy = true })
  await page.getByRole('button', { name: '快速复制密码 GitHub alice 个人账户', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('无法写入剪贴板')
})

test('密码显示、失焦收起、迟到响应和账户切换保护', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  await expect(page.getByTestId('password-value')).toHaveText('Demo! Password 中文')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByTestId('password-value')).toHaveText('••••••••••••')
  await page.evaluate(() => { (window as any).__fixture.delayPassword = 300 })
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByRole('button', { name: '显示密码', exact: true })).toBeEnabled()
  await expect(page.getByTestId('password-value')).toHaveText('••••••••••••')
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  await page.getByRole('button', { name: '选择 GitHub alice-work 工作账户', exact: true }).click()
  await expect(page.getByRole('button', { name: '显示密码', exact: true })).toBeEnabled()
  await expect(page.getByTestId('password-value')).toHaveText('••••••••••••')
})

test('编辑保留、更换和清空密码，失败时保留表单', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.getByLabel('新密码', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '保存账户', exact: true }).click()
  expect((await calls(page, 'save_account')).at(-1).args.input.password).toBeNull()
  expect(await calls(page, 'reveal_password')).toHaveLength(0)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '更换密码', exact: true }).click()
  await page.getByLabel('新密码', { exact: true }).fill('Replacement!')
  await page.evaluate(() => { (window as any).__fixture.failSave = true })
  await page.getByRole('button', { name: '保存账户', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('原数据已保留')
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('Replacement!')
  await page.evaluate(() => { (window as any).__fixture.failSave = false })
  await page.getByRole('button', { name: '保存账户', exact: true }).click()
  await page.getByRole('button', { name: '复制密码', exact: true }).click()
  expect(await clipboard(page)).toBe('Replacement!')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '清空密码', exact: true }).click()
  await page.getByRole('button', { name: '保存账户', exact: true }).click()
  await expect(page.getByRole('button', { name: '复制密码', exact: true })).toBeDisabled()
  await expect(page.getByTestId('password-value')).toHaveText('尚未记录')
})

test('手机号、邮箱反查跨平台账户，跳转时清除旧筛选', async ({ page }, info) => {
  await fixture(page)
  await page.getByLabel('检索平台', { exact: true }).fill('GitHub')
  await page.getByRole('button', { name: '关联查询', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('检索联系方式').fill('13800000000')
  await expect(dialog.locator('.lookup-account')).toHaveCount(3)
  await dialog.getByRole('button', { name: '邮箱', exact: true }).click()
  await dialog.getByLabel('检索联系方式').fill('WORK@EXAMPLE.COM')
  await expect(dialog.locator('.lookup-account')).toHaveCount(2)
  await page.screenshot({ animations: 'disabled', path: info.outputPath('related-accounts.png') })
  await dialog.getByRole('button', { name: '查看账户 GitHub alice-work', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('检索平台', { exact: true })).toHaveValue('')
  await expect(page.locator('.detail-title')).toContainText('工作账户')
  await page.getByRole('button', { name: '查询邮箱关联 1', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('检索联系方式')).toHaveValue('work@example.com')
  await expect(page.getByRole('dialog').locator('.lookup-account')).toHaveCount(2)
})

test('数据目录失败不丢失账户，备份导出与导入反馈', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  expect((await calls(page, 'export_backup'))[0].args.path).toMatch(/deskauth-backup-.*[a-f0-9]{8}$/)
  expect((await calls(page, 'plugin:dialog|open'))[0].args.options.directory).toBe(true)
  await page.getByRole('button', { name: '导入备份', exact: true }).click()
  await page.evaluate(() => { (window as any).__fixture.failImport = true })
  await page.getByRole('button', { name: '确认合并', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('无效的 DeskAuth 备份目录')
  await page.evaluate(() => { (window as any).__fixture.failImport = false })
  await page.getByRole('button', { name: '确认合并', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已导入 2 个账户，跳过 1 个重复项')
  await page.evaluate(() => { (window as any).__fixture.failDirectory = true })
  await page.getByRole('button', { name: '使用此目录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('有效数据目录')
  await expect(rows(page)).toHaveCount(4)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('button', { name: '复制密码', exact: true })).toBeEnabled()
})

test('删除失败可重试，切换目录重置列表和筛选', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '删除账户', exact: true }).click()
  await page.evaluate(() => { (window as any).__fixture.failDelete = true })
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('外部修改')
  await page.evaluate(() => { (window as any).__fixture.failDelete = false })
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(rows(page)).toHaveCount(3)
  await page.getByLabel('检索平台', { exact: true }).fill('GitHub')
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('button', { name: '浏览', exact: true }).click()
  await page.getByRole('button', { name: '使用此目录', exact: true }).click()
  await expect(rows(page)).toHaveCount(0)
  await expect(page.getByLabel('检索平台', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '添加第一个账户', exact: true })).toBeVisible()
})

test('界面尺寸、弹窗焦点与可滚动的多项编辑', async ({ page }, info) => {
  await fixture(page)
  await page.screenshot({ animations: 'disabled', path: info.outputPath('deskauth.png') })
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('平台', { exact: false }).first()).toBeFocused()
  await page.screenshot({ animations: 'disabled', path: info.outputPath('edit-account.png') })
  await dialog.getByRole('button', { name: '移除邮箱 2', exact: true }).click()
  await expect(dialog.getByLabel('邮箱 2', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeFocused()
  await page.setViewportSize({ width: 940, height: 660 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ animations: 'disabled', path: info.outputPath('minimum-window.png') })
  await page.getByRole('button', { name: '关联查询', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeVisible()
})

test('认证器配置、复制、普通编辑保留、参数修改与移除', async ({ page }, info) => {
  await fixture(page)
  await expect(page.getByRole('button', { name: '点击复制验证码', exact: true })).toHaveText('123 456')
  await page.evaluate(() => { (window as any).__fixture.nextCode = '654321' })
  await page.getByRole('button', { name: '复制验证码', exact: true }).click()
  expect(await clipboard(page)).toBe('654321')
  await page.getByRole('button', { name: '选择 GitHub alice-work 工作账户', exact: true }).click()
  await page.getByRole('button', { name: '配置认证器', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('认证器共享密钥', { exact: true }).fill('JBSWY3DPEHPK3PXP')
  await page.evaluate(() => { (window as any).__fixture.failTotp = true })
  await dialog.getByRole('button', { name: '保存认证器', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('原配置已保留')
  await page.evaluate(() => { (window as any).__fixture.failTotp = false })
  await dialog.getByRole('button', { name: '保存认证器', exact: true }).click()
  await expect(page.getByRole('button', { name: '点击复制验证码', exact: true })).toHaveText('654 321')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await dialog.getByRole('button', { name: '保存账户', exact: true }).click()
  await expect(page.getByRole('button', { name: '复制验证码', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '管理认证器', exact: true }).click()
  await expect(dialog.getByLabel('认证器共享密钥', { exact: true })).toHaveValue('')
  await dialog.getByRole('button', { name: '查看已保存密钥', exact: true }).click()
  await expect(dialog.getByText('JBSWY3DPEHPK3PXP', { exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(dialog.getByText('JBSWY3DPEHPK3PXP', { exact: true })).toHaveCount(0)
  await dialog.getByRole('combobox', { name: '算法', exact: true }).selectOption('SHA512')
  await dialog.getByRole('combobox', { name: '验证码位数', exact: true }).selectOption('8')
  await dialog.getByLabel('时间周期（秒）', { exact: true }).fill('60')
  await page.screenshot({ animations: 'disabled', path: info.outputPath('totp-settings.png') })
  await dialog.getByRole('button', { name: '保存认证器', exact: true }).click()
  expect((await calls(page, 'configure_totp')).at(-1).args.input.secret).toBeNull()
  await expect(page.getByRole('button', { name: '点击复制验证码', exact: true })).toHaveText('0065 4321')
  await page.getByRole('button', { name: '管理认证器', exact: true }).click()
  await dialog.getByRole('button', { name: '移除认证器', exact: true }).click()
  await expect(dialog).toContainText('账户密码和联系方式会保留')
  await dialog.getByRole('button', { name: '确认移除认证器', exact: true }).click()
  await expect(page.getByRole('button', { name: '配置认证器', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '复制密码', exact: true }).click()
  expect(await clipboard(page)).toBe('Work-demo-password')
  await expect(page.getByText('155 0000 0000', { exact: true })).toBeVisible()
})

test('认证链接与真实二维码图片导入后核对参数，不改动账户身份', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '管理认证器', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '链接 / 二维码', exact: true }).click()
  await dialog.getByRole('textbox', { name: '认证链接', exact: true }).fill('otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP')
  await dialog.getByRole('button', { name: '解析认证链接', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('仅支持 TOTP')
  await dialog.getByRole('textbox', { name: '认证链接', exact: true }).fill('otpauth://totp/Other:other?issuer=Other&secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60')
  await dialog.getByRole('button', { name: '解析认证链接', exact: true }).click()
  await expect(dialog).toContainText('已读取 Other')
  await expect(dialog).toContainText('GitHub · alice')
  await expect(dialog.getByRole('combobox', { name: '算法', exact: true })).toHaveValue('SHA256')
  await expect(dialog.getByRole('combobox', { name: '验证码位数', exact: true })).toHaveValue('8')
  await dialog.getByRole('button', { name: '保存认证器', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择 GitHub alice 个人账户', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '管理认证器', exact: true }).click()
  await dialog.getByRole('button', { name: '链接 / 二维码', exact: true }).click()
  await dialog.getByLabel('二维码图片', { exact: true }).setInputFiles('tests/fixtures/totp.png')
  await expect(dialog).toContainText('已读取')
  expect((await calls(page, 'parse_uri')).at(-1).args.uri).toContain('otpauth://totp/')
  await expect(dialog.getByLabel('认证器共享密钥', { exact: true })).toHaveValue('JBSWY3DPEHPK3PXP')
  await dialog.getByRole('button', { name: '保存认证器', exact: true }).click()
  await expect(page.getByRole('button', { name: '复制验证码', exact: true })).toBeEnabled()
})

test('账户详情集中显示 2FA 原码与验证码，支持复制、失焦和迟到响应保护', async ({ page }, info) => {
  await fixture(page)
  await expect(page.getByTestId('totp-secret')).toHaveText('••••••••••••••••')
  await page.getByRole('button', { name: '复制 2FA 原码', exact: true }).click()
  expect(await clipboard(page)).toBe('JBSWY3DPEHPK3PXP')
  expect(await calls(page, 'reveal_totp_secret')).toHaveLength(0)
  await page.getByRole('button', { name: '显示 2FA 原码', exact: true }).click()
  await expect(page.getByTestId('totp-secret')).toHaveText('JBSWY3DPEHPK3PXP')
  await expect(page.getByRole('button', { name: '点击复制验证码', exact: true })).toHaveText('123 456')
  await page.screenshot({ animations: 'disabled', path: info.outputPath('account-2fa.png') })
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByTestId('totp-secret')).toHaveText('••••••••••••••••')
  await page.evaluate(() => { (window as any).__fixture.delaySecret = 300 })
  await page.getByRole('button', { name: '显示 2FA 原码', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByRole('button', { name: '显示 2FA 原码', exact: true })).toBeEnabled()
  await expect(page.getByTestId('totp-secret')).toHaveText('••••••••••••••••')
  await page.getByRole('button', { name: '显示 2FA 原码', exact: true }).click()
  await page.getByRole('button', { name: '选择 GitHub alice-work 工作账户', exact: true }).click()
  await expect(page.getByTestId('totp-secret')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '配置认证器', exact: true })).toBeVisible()
})

test('平台主页独立配置、打开与清空，详情仍保留账户 2FA', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: '平台主页', exact: true }).fill('https://github.com/settings/profile')
  await dialog.getByRole('button', { name: '保存账户', exact: true }).click()
  expect((await calls(page, 'save_account')).at(-1).args.input.website).toBe('https://github.com/settings/profile')
  await page.getByRole('button', { name: '平台主页', exact: true }).click()
  expect((await calls(page, 'open_website')).at(-1).args.id).toBe('alice')
  await page.getByRole('button', { name: '打开平台主页', exact: true }).click()
  expect(await calls(page, 'open_website')).toHaveLength(2)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await dialog.getByRole('textbox', { name: '平台主页', exact: true }).fill('')
  await dialog.getByRole('button', { name: '保存账户', exact: true }).click()
  await expect(page.getByRole('button', { name: '平台主页', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '点击复制验证码', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '管理认证器', exact: true }).click()
  await expect(dialog.locator('.form-tabs button')).toHaveCount(2)
})

test('联网校时默认关闭，正负偏差下倒计时与复制一致，失败保留及关闭回退', async ({ page }, info) => {
  await fixture(page)
  await expect(page.getByRole('button', { name: '点击复制验证码', exact: true })).toBeEnabled()
  expect(await calls(page, 'set_online_time')).toHaveLength(0)
  expect(await calls(page, 'sync_time')).toHaveLength(0)
  await page.getByRole('button', { name: '时间校准', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('switch', { name: '联网校时' })).not.toBeChecked()
  await dialog.getByRole('switch', { name: '联网校时' }).click()
  await expect(dialog).toContainText('+90.000 秒')
  await page.screenshot({ animations: 'disabled', path: info.outputPath('time-settings.png') })
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '复制验证码', exact: true }).click()
  await expect(page.locator('.otp-card')).toContainText('网络校正时间')
  const countdown = await page.locator('.countdown').getAttribute('aria-label')
  expect(Number(countdown?.match(/\d+/)?.[0])).toBeGreaterThan(0)
  expect(Number(countdown?.match(/\d+/)?.[0])).toBeLessThanOrEqual(30)
  expect(await clipboard(page)).toBe('123456')
  await page.evaluate(() => { (window as any).__fixture.timeOffset = -90000 })
  await page.getByRole('button', { name: '时间校准', exact: true }).click()
  await dialog.getByRole('button', { name: '立即校时', exact: true }).click()
  await expect(dialog).toContainText('-90.000 秒')
  await page.evaluate(() => { (window as any).__fixture.failTime = true })
  await dialog.getByRole('button', { name: '立即校时', exact: true }).click()
  await expect(dialog).toContainText('时间来源请求超时')
  await expect(dialog).toContainText('仍在使用有效期内的上次校正结果')
  await dialog.getByRole('switch', { name: '联网校时' }).click()
  await expect(dialog).toContainText('0 秒')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.otp-card')).toContainText('本地时间')
  await page.getByRole('button', { name: '复制验证码', exact: true }).click()
  expect(await clipboard(page)).toBe('123456')
})

test('校时失败回退及请求中关闭，认证器读取失败不显示旧验证码', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).__fixture.failCode = true; (window as any).__fixture.failTime = true })
  await expect(page.locator('.otp-card').getByRole('alert')).toContainText('读取认证器失败')
  await expect(page.getByRole('button', { name: '复制验证码', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '时间校准', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('switch', { name: '联网校时' }).click()
  await expect(dialog).toContainText('时间来源请求超时')
  await expect(dialog).toContainText('当前使用本地系统时间')
  await page.evaluate(() => { const f = (window as any).__fixture; f.failTime = false; f.timeDelay = 1000 })
  await dialog.getByRole('button', { name: '立即校时', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '校时中…', exact: true })).toBeDisabled()
  await dialog.getByRole('switch', { name: '联网校时' }).click()
  await expect(dialog.getByRole('switch', { name: '联网校时' })).not.toBeChecked()
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.time.syncing)).toBe(false)
  await page.evaluate(() => { (window as any).__fixture.failCode = false })
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('button', { name: '点击复制验证码', exact: true })).toHaveText('123 456')
  await page.getByRole('button', { name: '复制密码', exact: true }).click()
  await expect(page.getByRole('button', { name: '时间校准', exact: true })).toHaveText('本地时间 · 离线')
})
