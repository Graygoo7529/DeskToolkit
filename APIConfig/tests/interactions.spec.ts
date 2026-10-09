import { test, expect, type Page, type TestInfo } from '@playwright/test'

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(name) })
}

async function fixture(page: Page, options: { delay?: number; count?: number } = {}) {
  await page.addInitScript(({ delay, count }) => {
    const inspection = (adapter = 'none') => ({ models_path: '', models_auth: 'bearer', quota: { adapter, path: '', auth: 'bearer', balance_pointer: '', used_pointer: '', limit_pointer: '', remaining_pointer: '', reset_pointer: '', unit: '' } })
    const provider = (name: string, adapter = 'none') => ({ name, color: name === 'Relay' ? '#86CDB7' : '#A7B8EF', url: `https://${name.toLowerCase().replace(/ /g, '-')}.example/v1`, key_masked: 'test…only', inspection: inspection(adapter) })
    const initial = {
      homes: [{ name: 'Personal', location: 'D:\\Fixtures\\codex' }, { name: 'Work', location: 'D:\\Fixtures\\work' }, { name: 'Lab', location: 'D:\\Fixtures\\lab' }],
      providers: [provider('Kimi', 'kimi'), provider('Relay', 'custom'), provider('Offline'), ...Array.from({ length: count ?? 0 }, (_, i) => provider(`Provider ${i + 1}`))],
      claude_homes: [{ name: 'Claude Home', location: 'D:\\Fixtures\\claude' }], claude_providers: [provider('Claude A'), provider('Claude B')],
      statuses: { Work: { matched_provider: 'Relay', config_exists: true, auth_exists: true, base_url: 'https://relay.example/v1', api_key_masked: 'test…only' } },
      claude_statuses: {}, data_dir: 'D:\\Fixtures\\APIConfig',
    }
    const state = JSON.parse(localStorage.getItem('fixture-state') ?? JSON.stringify(initial))
    let kimi = { name: 'Kimi Code', url: 'https://api.kimi.com/coding/v1', key_masked: 'test…only', configured: true }
    let apiAccounts = [{ id: 'api:Token Plan', kind: 'api', name: 'Token Plan', url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', anthropic_url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic', key_masked: 'sk-sp…only', color: '#A7B8EF', configured: true }]
    const subscriptions = () => [...apiAccounts, { id: 'kimi', kind: 'kimi', name: kimi.name, url: kimi.url, anthropic_url: '', key_masked: kimi.key_masked, color: '#9CA9FF', configured: kimi.configured }]
    const controls = { calls: [] as { cmd: string; args: any }[], delay: delay ?? 50, folder: 'D:\\Fixtures\\Moved', failDirectory: false, failModels: false, failKimi: false, failProbe: false, kimiPartial: false }
    ;(window as any).__fixture = controls
    ;(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any = {}) => {
      controls.calls.push({ cmd, args })
      const providers = args.scene === 'claude' ? state.claude_providers : state.providers
      const base = () => ({ status: 'ok', message: '查询成功', checked_at: Date.now(), latency_ms: 42, http_status: 200, models: [], quota: null }) as any
      if (cmd === 'plugin:dialog|open') return controls.folder
      if (cmd === 'change_data_dir') {
        if (controls.failDirectory) throw '目标目录已有配置；请选择使用已有配置'
        state.data_dir = args.path
        if (args.mode === 'existing') { state.providers = [provider('Saved provider')]; state.homes = []; state.statuses = {}; kimi = { ...kimi, name: 'Saved Kimi' } }
      }
      if (cmd === 'get_kimi_config') return kimi
      if (cmd === 'get_api_accounts') return subscriptions()
      if (cmd === 'probe_api_account') {
        await new Promise((resolve) => setTimeout(resolve, controls.delay))
        if (controls.failProbe) throw '网络连接失败'
        const isKimi = args.id === 'kimi'
        return { models: { ...base(), models: [{ id: isKimi ? 'kimi-k2.5' : 'qwen3.7-plus', name: null }, { id: isKimi ? 'kimi-k2' : 'qwen3.6-flash', name: null }, ...isKimi ? [] : [{ id: 'glm-5.3', name: null }]] }, quota: isKimi ? controls.failKimi ? { ...base(), status: 'error', message: 'HTTP 401 · 认证失败', quota: null } : { ...base(), status: controls.kimiPartial ? 'partial' : 'ok', quota: { balance: null, unit: '', membership: 'LEVEL_2', windows: [{ name: '周额度', used: controls.kimiPartial ? null : 26, limit: 100, remaining: 74, reset_at: '2026-10-05T12:00:00Z' }, ...controls.kimiPartial ? [] : [{ name: '5 小时窗口', used: 4, limit: 100, remaining: 96, reset_at: '2026-10-02T12:00:00Z' }]] } } : null }
      }
      if (cmd === 'check_api_model') return { ...base(), message: `${args.protocol} 可用` }
      if (cmd === 'save_api_account') { apiAccounts = [{ id: `api:${args.name}`, kind: 'api', name: args.name, url: args.url, anthropic_url: args.anthropicUrl, key_masked: 'sk-sp…only', color: '#A7B8EF', configured: true }]; return subscriptions() }
      if (cmd === 'delete_api_account') { apiAccounts = []; return subscriptions() }
      if (cmd === 'save_kimi_config') { kimi = { ...kimi, name: args.name, url: args.url, configured: true }; return kimi }
      if (cmd === 'inspect_provider') {
        const p = providers.find((p: any) => p.name === args.name)
        await new Promise((resolve) => setTimeout(resolve, controls.delay))
        if (args.task === 'quota' && p.inspection.quota.adapter === 'none') return { ...base(), status: 'skipped', message: '未配置额度查询，已跳过' }
        if (args.name === 'Offline' || (args.task === 'models' && controls.failModels)) return { ...base(), status: 'error', message: 'HTTP 401 · 认证失败或无权限', http_status: 401 }
        if (args.task === 'models') return { ...base(), models: [{ id: 'fixture-opus', name: 'Fixture Opus' }, { id: 'fixture-fast', name: null }] }
        if (args.task === 'quota') return { ...base(), status: 'partial', message: '部分额度字段缺失，已展示可用数据', quota: { balance: null, unit: '', membership: null, windows: [{ name: '周额度', used: null, limit: 100, remaining: 30, reset_at: null }] } }
        return base()
      }
      if (cmd === 'reorder_items') {
        const key = `${args.scene === 'claude' ? 'claude_' : ''}${args.kind}`
        state[key] = args.names.map((name: string) => state[key].find((p: any) => p.name === name))
      }
      if (cmd === 'save_inspection') providers.find((p: any) => p.name === args.name).inspection = args.settings
      if (cmd === 'save_provider' || cmd === 'save_claude_provider') {
        const list = cmd === 'save_provider' ? state.providers : state.claude_providers
        const p = list.find((p: any) => p.name === args.originalName)
        if (p) Object.assign(p, { name: args.name, url: args.url })
      }
      if (cmd === 'delete_provider') state.providers = state.providers.filter((p: any) => p.name !== args.name)
      if (cmd === 'apply_provider') state.statuses[args.homeName] = { matched_provider: args.providerName, config_exists: true, auth_exists: true, base_url: 'https://fixture.example/v1', api_key_masked: 'test…only' }
      if (cmd === 'apply_claude_provider') state.claude_statuses[args.claudeHomeName] = { matched_provider: args.claudeProviderName, settings_exists: true, base_url: 'https://fixture.example', auth_token_masked: 'test…only' }
      localStorage.setItem('fixture-state', JSON.stringify(state))
      return JSON.parse(JSON.stringify(state))
    } }
  }, options)
  await page.goto('/')
}

const codex = (page: Page) => page.locator('#panel-codex')
async function idle(page: Page) { await expect(codex(page).locator('.pane-footer').first()).toContainText('启动检查完成') }
async function details(page: Page, name: string) { await page.getByRole('button', { name: `查看 ${name} 详情`, exact: true }).click(); return page.getByRole('dialog') }

test('启动只检查连接一次，检查期间仍可选择与应用', async ({ page }, testInfo) => {
  await fixture(page, { delay: 2000 })
  const panel = codex(page)
  await expect(panel.locator('.pane-footer').first()).toContainText('启动连接检查')
  await panel.getByRole('button', { name: 'Kimi', exact: true }).click()
  const apply = panel.getByRole('button', { name: '应用「Kimi」到「Personal」', exact: true })
  await expect(apply).toBeInViewport()
  await apply.click()
  await expect(panel.getByRole('button', { name: 'Personal 已使用 Kimi', exact: true })).toBeDisabled()
  await idle(page)
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  await page.getByRole('tab', { name: 'Codex', exact: true }).click()
  const calls = await page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => c.cmd === 'inspect_provider'))
  expect(calls).toHaveLength(5)
  expect(calls.every((c: any) => c.args.task === 'connection')).toBe(true)
  await expect(panel.locator('.provider-card').first()).toHaveClass(/connection-ok/)
  await expect(panel.locator('.provider-card').nth(2)).toHaveClass(/connection-error/)
  await expect(panel.locator('input[type=checkbox]')).toHaveCount(0)
  await expect(panel.locator('.provider-inspection')).toHaveCount(0)
  expect(await panel.locator('.provider-card').evaluateAll((cards) => cards.slice(1).every((card, i) => card.getBoundingClientRect().top >= cards[i].getBoundingClientRect().bottom))).toBe(true)
  await capture(page, testInfo, 'workspace.png')
})

test('全选只用于批量查询，详情隐藏且不挤压目标配置', async ({ page }, testInfo) => {
  await fixture(page)
  await idle(page)
  const panel = codex(page)
  await panel.getByRole('button', { name: 'Kimi', exact: true }).click()
  await panel.getByRole('button', { name: '全选', exact: true }).click()
  await panel.getByRole('button', { name: '全部检查', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('9 / 9 项 · 成功 4 · 部分 2 · 失败 2 · 跳过 1')
  const targetBefore = await panel.locator('.target-pane').boundingBox()
  const drawer = await details(page, 'Kimi')
  await drawer.locator('summary').filter({ hasText: '模型发现' }).click()
  await drawer.getByRole('textbox', { name: '搜索模型' }).fill('opus')
  await expect(drawer.locator('.model-list')).toHaveText('fixture-opusFixture Opus')
  await drawer.locator('summary').filter({ hasText: '额度查询' }).click()
  await expect(drawer.locator('.quota-results')).toContainText('已用 —')
  expect(await panel.locator('.target-pane').boundingBox()).toEqual(targetBefore)
  await capture(page, testInfo, 'provider-drawer.png')
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Kimi', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('button', { name: '应用「Kimi」到「Personal」', exact: true })).toBeInViewport()
})

test('详情重试失败保留上次模型并能重新打开', async ({ page }) => {
  await fixture(page); await idle(page)
  let drawer = await details(page, 'Kimi')
  await drawer.locator('summary').filter({ hasText: '模型发现' }).click()
  await drawer.getByRole('button', { name: '模型发现', exact: true }).click()
  await expect(drawer.locator('.model-list')).toContainText('fixture-opus')
  await page.evaluate(() => { (window as any).__fixture.failModels = true })
  await drawer.getByRole('button', { name: '模型发现', exact: true }).click()
  await expect(drawer.locator('.stale')).toContainText('上次可用结果')
  await page.keyboard.press('Escape')
  drawer = await details(page, 'Kimi')
  await drawer.locator('summary').filter({ hasText: '模型发现' }).click()
  await expect(drawer.locator('.model-list')).toContainText('fixture-opus')
})

test('整卡拖动与键盘排序保存，不触发选择或应用', async ({ page }) => {
  await fixture(page); await idle(page)
  const panel = codex(page)
  const rows = panel.locator('.provider-list .sortable-item')
  await rows.first().dragTo(rows.nth(1), { sourcePosition: { x: 7, y: 30 }, targetPosition: { x: 7, y: 35 } })
  await expect(panel.locator('.provider-name')).toHaveText(['Relay', 'Kimi', 'Offline'])
  await expect(panel.locator('.apply-context')).toContainText('从左侧选择一个 Provider')
  const homes = panel.locator('.home-list .sortable-item')
  await homes.first().dragTo(homes.nth(1), { sourcePosition: { x: 6, y: 50 }, targetPosition: { x: 6, y: 50 } })
  await expect(panel.locator('.target-card .card-title')).toHaveText(['Work', 'Personal', 'Lab'])
  expect(await page.evaluate(() => (window as any).__fixture.calls.some((c: any) => c.cmd.startsWith('apply_')))).toBe(false)
  await page.reload(); await idle(page)
  await expect(panel.locator('.provider-name')).toHaveText(['Relay', 'Kimi', 'Offline'])
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  await page.getByRole('group', { name: '排序 Claude A', exact: true }).focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(page.locator('#panel-claude .provider-name')).toHaveText(['Claude B', 'Claude A'])
})

test('长 Provider 列表独立滚动，920×620 下目标应用保持可见', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 920, height: 620 })
  await fixture(page, { count: 24 })
  const panel = codex(page)
  await panel.getByRole('button', { name: 'Kimi', exact: true }).click()
  const before = await panel.locator('.target-pane').boundingBox()
  await panel.locator('.providers-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect(panel.getByRole('button', { name: 'Provider 24', exact: true })).toBeInViewport()
  expect(await panel.locator('.target-pane').boundingBox()).toEqual(before)
  await expect(panel.getByRole('button', { name: '应用「Kimi」到「Personal」', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await panel.getByRole('textbox', { name: '搜索 Provider' }).fill('Provider 24')
  await expect(panel.locator('.provider-name')).toHaveText(['Provider 24'])
  await expect(panel.getByRole('button', { name: 'Provider 24', exact: true })).toBeInViewport()
  await expect(panel.locator('.provider-list .sortable-item')).toHaveAttribute('draggable', 'false')
  await capture(page, testInfo, 'compact-workspace.png')
})

test('Claude 额度设置仍可保存，目标可应用并查看配置详情', async ({ page }) => {
  await fixture(page); await idle(page)
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  let drawer = await details(page, 'Claude A')
  await drawer.getByRole('button', { name: '查询设置', exact: true }).last().click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('额度适配器').selectOption('custom')
  await modal.getByLabel('额度接口路径').fill('/account/usage')
  await modal.getByLabel('余额', { exact: true }).fill('/data/balance')
  await modal.getByLabel('单位').fill('USD')
  await modal.getByRole('button', { name: '保存查询设置' }).click()
  await expect(modal).toHaveCount(0)
  const args = await page.evaluate(() => (window as any).__fixture.calls.find((c: any) => c.cmd === 'save_inspection').args)
  expect(args.settings.quota).toMatchObject({ adapter: 'custom', path: '/account/usage', balance_pointer: '/data/balance', unit: 'USD' })
  await page.getByRole('button', { name: 'Claude A', exact: true }).click()
  await page.getByRole('button', { name: '应用「Claude A」到「Claude Home」', exact: true }).click()
  await page.getByRole('button', { name: '查看 Claude Home 配置', exact: true }).click()
  drawer = page.getByRole('dialog')
  await expect(drawer).toContainText('Claude A')
  await expect(drawer).toContainText('settings.json 已存在')
})

test('启动旧请求不会在编辑 Provider 后恢复旧状态', async ({ page }) => {
  await fixture(page, { delay: 1800 })
  const drawer = await details(page, 'Kimi')
  await drawer.getByRole('button', { name: '编辑 Provider', exact: true }).click()
  await page.getByRole('dialog').getByLabel('名称', { exact: true }).fill('Kimi new')
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await idle(page)
  const updated = codex(page).locator('.provider-card').filter({ has: page.getByRole('button', { name: 'Kimi new', exact: true }) })
  await expect(updated).toHaveClass(/connection-idle/)
  await expect(updated.getByRole('img', { name: '尚未检查', exact: true })).toBeVisible()
})

test('停止批量队列保留已开始任务且不取消应用选择', async ({ page }) => {
  await fixture(page); await idle(page)
  await page.evaluate(() => { (window as any).__fixture.delay = 1200 })
  const panel = codex(page)
  await panel.getByRole('button', { name: '全选', exact: true }).click()
  await panel.getByRole('button', { name: '全部检查', exact: true }).click()
  await panel.getByRole('button', { name: '停止', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('已取消 6')
  await expect(panel.getByRole('button', { name: '全部检查', exact: true })).toBeEnabled()
})

test('API 订阅首次打开自动刷新，显示 Kimi 额度且可恢复部分数据', async ({ page }, testInfo) => {
  await fixture(page)
  expect(await page.evaluate(() => (window as any).__fixture.calls.some((c: any) => c.cmd === 'probe_api_account'))).toBe(false)
  await page.getByRole('tab', { name: 'API 订阅', exact: true }).click()
  const panel = page.locator('#panel-api')
  await panel.locator('.api-account').filter({ hasText: 'Kimi Code' }).click()
  await expect(panel.locator('.subscription-quota-ring').first()).toContainText('74%')
  await expect(panel.locator('.subscription-quota-ring').nth(1)).toContainText('96%')
  await expect(panel.locator('.api-model-row')).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => c.cmd === 'probe_api_account').length)).toBe(2)
  await capture(page, testInfo, 'api-subscriptions-kimi.png')
  await page.evaluate(() => { (window as any).__fixture.failKimi = true })
  await panel.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(panel.locator('.quota-error')).toContainText('HTTP 401')
  await expect(panel.locator('.subscription-quota-ring').first()).toContainText('74%')
  await expect(panel.locator('.api-account').filter({ hasText: 'Kimi Code' }).locator('.api-account-dot')).toHaveClass(/ok/)
  await page.evaluate(() => { (window as any).__fixture.failKimi = false; (window as any).__fixture.kimiPartial = true })
  await panel.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(panel.locator('.subscription-quota-ring').nth(1)).toContainText('—')
  await page.getByRole('tab', { name: 'Codex', exact: true }).click()
  await page.getByRole('tab', { name: 'API 订阅', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => c.cmd === 'probe_api_account').length)).toBe(6)
})

test('API 订阅保留模型过滤、协议切换与 Kimi Key 编辑', async ({ page }) => {
  await fixture(page)
  await page.getByRole('tab', { name: 'API 订阅', exact: true }).click()
  const panel = page.locator('#panel-api')
  await panel.getByLabel('过滤模型').fill('qwen3.7')
  await expect(panel.locator('.api-model-row')).toHaveCount(1)
  await panel.getByLabel('过滤模型').fill('')
  await panel.getByRole('button', { name: 'Anthropic', exact: true }).click()
  await panel.getByRole('button', { name: /qwen3\.7-plus/ }).click()
  const check = await page.evaluate(() => (window as any).__fixture.calls.findLast((c: any) => c.cmd === 'check_api_model'))
  expect(check.args.protocol).toBe('anthropic')
  expect(check.args.model).toBe('qwen3.7-plus')
  await panel.locator('.api-account').filter({ hasText: 'Kimi Code' }).click()
  await expect(panel.locator('.subscription-quota-ring').first()).toBeVisible()
  await panel.getByRole('button', { name: '编辑账号' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Kimi API Key')).toHaveValue('')
  await dialog.getByLabel('账号名称').fill('My Kimi')
  await dialog.getByRole('button', { name: '保存账号' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.locator('.api-account').filter({ hasText: 'My Kimi' })).toBeVisible()
  const call = await page.evaluate(() => (window as any).__fixture.calls.findLast((c: any) => c.cmd === 'save_kimi_config'))
  expect(call.args.key).toBe('')
})

test('来源身份色贯穿已应用目标，选中与取消只改变匹配光晕', async ({ page }, testInfo) => {
  await fixture(page); await idle(page)
  const panel = codex(page)
  const relay = panel.locator('.provider-card').filter({ has: page.getByRole('button', { name: 'Relay', exact: true }) })
  const work = panel.locator('.target-card').filter({ has: page.getByRole('heading', { name: 'Work', exact: true }) })
  const personal = panel.locator('.target-card').filter({ has: page.getByRole('heading', { name: 'Personal', exact: true }) })
  await expect(relay.locator('.applied-count')).toHaveText('1 个目标')
  await expect(work).toHaveClass(/has-provider/)
  expect(await work.evaluate((el) => el.style.getPropertyValue('--provider-color'))).toBe(await relay.evaluate((el) => el.style.getPropertyValue('--provider-color')))
  await panel.getByRole('button', { name: 'Relay', exact: true }).click()
  await expect(work).toHaveClass(/matches/)
  await expect(personal).not.toHaveClass(/matches/)
  await expect(panel.locator('.apply-context')).toContainText('1 个目标已生效')
  await panel.getByRole('button', { name: '应用「Relay」到「Personal」', exact: true }).click()
  await expect(personal).toHaveClass(/matches/)
  await expect(relay.locator('.applied-count')).toHaveText('2 个目标')
  await capture(page, testInfo, 'provider-colors.png')
  await panel.getByRole('button', { name: '取消待应用 Provider' }).click()
  await expect(work).not.toHaveClass(/matches/)
  await expect(work).toHaveClass(/has-provider/)
  await panel.getByRole('button', { name: 'Relay', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await work.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  expect(await work.evaluate((el) => getComputedStyle(el, '::after').display)).toBe('none')
})

test('数据目录可选择并复制，切换即时刷新且重启保持', async ({ page }, testInfo) => {
  await fixture(page); await idle(page)
  await codex(page).getByRole('button', { name: 'Relay', exact: true }).click()
  await page.getByRole('button', { name: '数据目录设置' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('kimi.toml')
  await dialog.getByRole('button', { name: '选择目录', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '新的数据目录' })).toHaveValue('D:\\Fixtures\\Moved')
  await capture(page, testInfo, 'storage-settings.png')
  await dialog.getByRole('button', { name: '复制并切换', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '数据目录设置' })).toHaveAttribute('title', 'D:\\Fixtures\\Moved')
  await expect(codex(page).locator('.provider-name')).toHaveText(['Kimi', 'Relay', 'Offline'])
  await expect(codex(page).locator('.apply-context')).toContainText('从左侧选择一个 Provider')
  await page.reload(); await idle(page)
  await expect(page.getByRole('button', { name: '数据目录设置' })).toHaveAttribute('title', 'D:\\Fixtures\\Moved')
})

test('目录冲突可修正，使用已有配置会替换场景及 Kimi 账号并停止旧队列', async ({ page }) => {
  await fixture(page, { delay: 500, count: 10 })
  await page.getByRole('button', { name: '数据目录设置' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '选择目录', exact: true }).click()
  await page.evaluate(() => { (window as any).__fixture.failDirectory = true })
  await dialog.getByRole('button', { name: '复制并切换', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('目标目录已有配置')
  await page.evaluate(() => { (window as any).__fixture.failDirectory = false })
  await dialog.getByRole('button', { name: '使用已有配置', exact: false }).click()
  await dialog.getByRole('button', { name: '使用此目录', exact: true }).click()
  await expect(codex(page).locator('.provider-name')).toHaveText(['Saved provider'])
  await idle(page)
  await page.getByRole('tab', { name: 'API 订阅', exact: true }).click()
  await expect(page.locator('.api-account').filter({ hasText: 'Saved Kimi' })).toBeVisible()
  const calls = await page.evaluate(() => (window as any).__fixture.calls)
  const switched = calls.findLastIndex((c: any) => c.cmd === 'change_data_dir')
  expect(calls.slice(switched + 1).filter((c: any) => c.cmd === 'inspect_provider' && c.args.scene === 'codex').every((c: any) => c.args.name === 'Saved provider')).toBe(true)
})

test('API 订阅整合账号状态、额度与协议模型检查，删除位于编辑中', async ({ page }, testInfo) => {
  await fixture(page)
  await page.getByRole('tab', { name: 'API 订阅', exact: true }).click()
  const panel = page.locator('#panel-api')
  await expect(panel.locator('.api-account').first()).toContainText('Token Plan')
  await expect(panel.locator('.api-quota-section')).toContainText('bl usage token-plan')
  const tokenPlan = panel.locator('.api-account').filter({ hasText: 'Token Plan' })
  await expect(tokenPlan.locator('.api-account-dot')).toHaveClass(/ok/)
  await page.evaluate(() => { (window as any).__fixture.failProbe = true })
  await panel.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(tokenPlan.locator('.api-account-dot')).toHaveClass(/error/)
  await page.evaluate(() => { (window as any).__fixture.failProbe = false })
  await expect(panel.locator('.api-quota-section')).toContainText('当前 Key 未提供订阅 Credits 查询接口')
  await expect(panel.locator('.api-model-row')).toHaveCount(3)
  await capture(page, testInfo, 'api-management.png')
  await panel.getByRole('button', { name: '编辑账号', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('input[type="password"]')).toHaveValue('')
  await expect(dialog.getByRole('button', { name: '删除账号' })).toBeVisible()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await panel.getByRole('button', { name: 'Anthropic', exact: true }).click()
  await panel.getByRole('button', { name: /qwen3\.7-plus/ }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.calls.some((c: any) => c.cmd === 'check_api_model' && c.args.protocol === 'anthropic'))).toBe(true)
})
