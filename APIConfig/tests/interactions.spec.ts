import { test, expect, type Page } from '@playwright/test'

// 仅测试注入：生产包不包含 mock，也不会读取用户配置或发往外部 API。
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const inspection = (adapter = 'none') => ({ models_path: '', models_auth: 'bearer', quota: { adapter, path: '', auth: 'bearer', balance_pointer: '', used_pointer: '', limit_pointer: '', remaining_pointer: '', reset_pointer: '', unit: '' } })
    const provider = (name: string, adapter = 'none') => ({ name, url: `https://${name.toLowerCase()}.example/v1`, key_masked: 'test…only', inspection: inspection(adapter) })
    const initial = {
      homes: [{ name: 'Personal', location: 'D:\\Fixtures\\codex' }, { name: 'Work', location: 'D:\\Fixtures\\work' }],
      providers: [provider('Kimi', 'kimi'), provider('Relay', 'custom'), provider('Offline')],
      claude_homes: [{ name: 'Claude Home', location: 'D:\\Fixtures\\claude' }],
      claude_providers: [provider('Claude A'), provider('Claude B')],
      statuses: {}, claude_statuses: {}, data_dir: 'D:\\Fixtures\\APIConfig',
    }
    const state = JSON.parse(localStorage.getItem('fixture-state') ?? JSON.stringify(initial))
    const controls = { calls: [] as { cmd: string; args: any }[], delay: 100, failModels: false }
    ;(window as any).__fixture = controls
    ;(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any = {}) => {
      controls.calls.push({ cmd, args })
      const providers = args.scene === 'claude' ? state.claude_providers : state.providers
      if (cmd === 'inspect_provider') {
        await new Promise((resolve) => setTimeout(resolve, controls.delay))
        const p = providers.find((p: any) => p.name === args.name)
        const result = { status: 'ok', message: '查询成功', checked_at: Date.now(), latency_ms: 42, http_status: 200, models: [], quota: null } as any
        if (args.task === 'quota' && p.inspection.quota.adapter === 'none') return { ...result, status: 'skipped', message: '未配置额度查询，已跳过' }
        if (args.name === 'Offline' || (args.task === 'models' && controls.failModels)) return { ...result, status: 'error', message: 'HTTP 401 · 认证失败或无权限', http_status: 401 }
        if (args.task === 'models') result.models = [{ id: 'fixture-opus', name: 'Fixture Opus' }, { id: 'fixture-fast', name: null }]
        if (args.task === 'quota') return { ...result, status: 'partial', message: '部分额度字段缺失，已展示可用数据', quota: { balance: null, unit: '', membership: null, windows: [{ name: '周额度', used: null, limit: 100, remaining: 30, reset_at: null }] } }
        return result
      }
      if (cmd === 'reorder_items') {
        const key = `${args.scene === 'claude' ? 'claude_' : ''}${args.kind}`
        state[key] = args.names.map((name: string) => state[key].find((p: any) => p.name === name))
      }
      if (cmd === 'save_inspection') providers.find((p: any) => p.name === args.name).inspection = args.settings
      if (cmd === 'apply_provider') state.statuses[args.homeName] = { matched_provider: args.providerName, config_exists: true, auth_exists: true, base_url: 'https://fixture.example/v1', api_key_masked: 'test…only' }
      if (cmd === 'apply_claude_provider') state.claude_statuses[args.claudeHomeName] = { matched_provider: args.claudeProviderName, settings_exists: true, base_url: 'https://fixture.example', auth_token_masked: 'test…only' }
      localStorage.setItem('fixture-state', JSON.stringify(state))
      return JSON.parse(JSON.stringify(state))
    } }
  })
  await page.goto('/')
}

test('手动批量查询允许失败和缺项，选择应用与勾选互不干扰', async ({ page }) => {
  await fixture(page)
  const codex = page.locator('#panel-codex')
  await expect(codex.getByRole('button', { name: '应用 Provider', exact: true }).first()).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => c.cmd === 'inspect_provider').length)).toBe(0)
  await codex.getByRole('checkbox', { name: '批量选择 Kimi' }).check()
  await expect(codex.getByRole('button', { name: '应用 Provider', exact: true }).first()).toBeDisabled()
  await codex.getByRole('button', { name: 'Kimi', exact: true }).click()
  await codex.getByRole('checkbox', { name: '全选 Provider' }).check()
  await codex.getByRole('button', { name: '检查三项', exact: true }).click()
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  await expect(page.locator('#panel-claude').getByText('未查询').first()).toBeVisible()
  await page.getByRole('tab', { name: 'Codex', exact: true }).click()
  await expect(codex.getByRole('status')).toContainText('9 / 9')
  await expect(codex.getByRole('status')).toContainText('成功 4 · 部分 2 · 失败 2 · 跳过 1')
  const kimi = codex.locator('.provider-card').filter({ has: page.getByRole('button', { name: 'Kimi', exact: true }) })
  await kimi.locator('summary').filter({ hasText: '模型发现' }).click()
  await kimi.getByRole('textbox', { name: '搜索模型' }).fill('opus')
  await expect(kimi.locator('.model-list')).toHaveText('fixture-opusFixture Opus')
  await kimi.locator('summary').filter({ hasText: '额度查询' }).click()
  await expect(kimi.locator('.quota-results')).toContainText('剩余 30')
  await expect(kimi.locator('.quota-results')).toContainText('已用 —')
  await expect(codex.getByRole('button', { name: '应用「Kimi」', exact: true }).first()).toBeEnabled()
  await codex.getByRole('button', { name: '应用「Kimi」', exact: true }).first().click()
  await expect(codex.locator('.home-card').first()).toContainText('当前：Kimi')
  await page.screenshot({ path: 'test-results/providers.png', fullPage: true })
})

test('重新查询失败保留上次结果，模型详情不改变待应用 Provider', async ({ page }) => {
  await fixture(page)
  const card = page.locator('#panel-codex .provider-card').first()
  await card.getByRole('button', { name: 'Kimi', exact: true }).click()
  await card.locator('summary').filter({ hasText: '模型发现' }).click()
  await card.getByRole('button', { name: '模型发现', exact: true }).click()
  await expect(card.locator('.model-list')).toContainText('fixture-opus')
  await page.evaluate(() => { (window as any).__fixture.failModels = true })
  await card.getByRole('button', { name: '模型发现', exact: true }).click()
  await expect(card.locator('.stale')).toContainText('上次可用结果')
  await expect(card.locator('.model-list')).toContainText('fixture-opus')
  await expect(card.getByRole('button', { name: 'Kimi', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('Provider 和 Home 拖动排序保存，重载后顺序保留', async ({ page }) => {
  await fixture(page)
  const codex = page.locator('#panel-codex')
  await codex.getByRole('button', { name: '拖动排序 Kimi', exact: true }).dragTo(codex.locator('.provider-grid .sortable-item').nth(1))
  await expect(codex.locator('.provider-name')).toHaveText(['Relay', 'Kimi', 'Offline'])
  await codex.getByRole('button', { name: '拖动排序 Personal', exact: true }).dragTo(codex.locator('.home-list .sortable-item').nth(1))
  await expect(codex.locator('.home-card .card-title')).toHaveText(['Work', 'Personal'])
  await page.reload()
  await expect(codex.locator('.provider-name')).toHaveText(['Relay', 'Kimi', 'Offline'])
  await expect(codex.locator('.home-card .card-title')).toHaveText(['Work', 'Personal'])
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  await page.getByRole('button', { name: '拖动排序 Claude A', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('#panel-claude .provider-name')).toHaveText(['Claude B', 'Claude A'])
})

test('额度设置独立保存，Claude 的应用流程保持可用', async ({ page }) => {
  await fixture(page)
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  const claude = page.locator('#panel-claude')
  const card = claude.locator('.provider-card').first()
  await card.getByRole('button', { name: '查询设置', exact: true }).first().click()
  const modal = page.locator('.modal')
  await modal.getByLabel('额度适配器').selectOption('custom')
  await modal.getByLabel('额度接口路径').fill('/account/usage')
  await modal.getByLabel('余额', { exact: true }).fill('/data/balance')
  await modal.getByLabel('单位').fill('USD')
  await modal.getByRole('button', { name: '保存查询设置' }).click()
  await expect(modal).toHaveCount(0)
  const args = await page.evaluate(() => (window as any).__fixture.calls.find((c: any) => c.cmd === 'save_inspection').args)
  expect(args.scene).toBe('claude')
  expect(args.settings.quota).toMatchObject({ adapter: 'custom', path: '/account/usage', balance_pointer: '/data/balance', unit: 'USD' })
  await card.getByRole('button', { name: 'Claude A', exact: true }).click()
  await claude.getByRole('button', { name: '应用「Claude A」', exact: true }).click()
  await expect(claude.locator('.home-card')).toContainText('当前：Claude A')
})

test('停止批量队列时已开始请求结束，剩余项不再启动', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).__fixture.delay = 1000 })
  const codex = page.locator('#panel-codex')
  await codex.getByRole('checkbox', { name: '全选 Provider' }).check()
  await codex.getByRole('button', { name: '检查三项', exact: true }).click()
  await codex.getByRole('button', { name: '停止待执行项', exact: true }).click()
  await expect(codex.getByRole('status')).toContainText('已取消 6')
  expect(await page.evaluate(() => (window as any).__fixture.calls.filter((c: any) => c.cmd === 'inspect_provider').length)).toBe(3)
  await expect(codex.getByRole('button', { name: '检查三项', exact: true })).toBeEnabled()
})
