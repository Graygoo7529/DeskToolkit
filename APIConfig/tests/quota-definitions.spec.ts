import { test, expect, type Page } from '@playwright/test'

async function openProbe(page: Page, mode: 'daily' | 'balance' | 'missing' | 'failed') {
  await page.addInitScript((mode) => {
    const subscription = mode !== 'balance'
    const profile = {
      id: 'fixture', kind: subscription ? 'subscription' : 'balance', label: '测试方案',
      description: '测试', layout_id: 'fixture_layout', layout_label: subscription ? '额度' : '余额',
      blocks: [{ component: subscription ? 'quota_card' : 'balance_card', source: subscription ? 'windows.daily' : 'balance', title: subscription ? '日额度' : '账户余额' }],
    }
    const quota = { profile: 'fixture', path: '', auth: 'bearer', balance_pointer: '', used_pointer: '', limit_pointer: '', remaining_pointer: '', reset_pointer: '', unit: '' }
    const account = {
      id: 'api:测试账号', name: '测试账号', kind: subscription ? 'subscription' : 'direct',
      configured: true, url: 'https://fixture.example/v1', color: '#A7B8EF', key_masked: 'test…only', console_url: '',
      endpoints: [{ protocol: 'openai', url: 'https://fixture.example/v1', auth: 'bearer' }],
      quota_adapter: 'fixture', quota,
    }
    const state = { homes: [], providers: [], claude_homes: [], claude_providers: [], statuses: {}, claude_statuses: {}, data_dir: 'D:\\Fixture' }
    const result = { status: 'ok', checked_at: Date.now(), latency_ms: 12, http_status: 200, models: [], quota: null, message: '完成' }
    ;(window as any).__quotaCalls = []
    ;(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => {
      ;(window as any).__quotaCalls.push({ cmd, args })
      if (cmd === 'get_state') return state
      if (cmd === 'get_api_accounts') return [account]
      if (cmd === 'get_api_probe_profiles') return [profile, { id: 'balance_custom', kind: 'custom', label: '新建查询方案', description: '', layout_id: 'balance', layout_label: '余额', blocks: [] }]
      if (cmd === 'probe_api_account') return {
        model_sets: [{ protocol: 'openai', result: { ...result, models: [{ id: 'fixture-model', name: null }] } }],
        quota: { ...result, status: mode === 'missing' ? 'partial' : mode === 'failed' ? 'error' : 'ok',
          message: mode === 'failed' ? '查询失败' : mode === 'missing' ? '部分字段缺失' : '额度已更新',
          quota: mode === 'failed' ? null : {
            balance: mode === 'balance' ? 0 : 999, unit: 'USD', membership: null,
            windows: mode === 'missing' ? [] : [
              { id: 'daily', name: '来自响应的错误名称', used: 10, limit: 50, remaining: 40, reset_at: null },
              { id: 'weekly', name: '周额度', used: 26.9, limit: 0, remaining: -26.9, reset_at: null },
            ],
          },
        },
      }
      if (cmd === 'save_api_account') return [{ ...account, quota: { ...quota, ...args.quota } }]
      throw new Error('Unexpected command ' + cmd)
    } }
  }, mode)
  await page.goto('/')
  await page.getByRole('tab', { name: 'API Probe', exact: true }).click()
  await expect(page.locator('.api-model-row')).toHaveText('fixture-model')
}

test('TOML 决定卡片数量、名称和类型，响应里的余额和多余窗口不改变布局', async ({ page }, testInfo) => {
  await openProbe(page, 'daily')
  const cards = page.locator('.subscription-quota')
  await expect(cards).toHaveCount(1)
  await expect(cards).toHaveAttribute('data-component', 'quota_card')
  await expect(cards.locator('.subscription-quota-head')).toHaveText('日额度周期额度')
  await expect(cards).toContainText('80%')
  await expect(cards).not.toContainText('账户余额')
  await page.screenshot({ path: testInfo.outputPath('daily-layout.png') })
})

for (const mode of ['missing', 'failed'] as const) {
  test('查询 ' + mode + ' 时保留声明的日额度卡片', async ({ page }) => {
    await openProbe(page, mode)
    await expect(page.locator('.subscription-quota')).toHaveCount(1)
    await expect(page.locator('.subscription-quota-head')).toHaveText('日额度周期额度')
    await expect(page.locator('.subscription-quota-values')).toHaveText('已用—总量—剩余—')
  })
}

test('余额组件保留零余额，并忽略所有额度窗口', async ({ page }) => {
  await openProbe(page, 'balance')
  await expect(page.locator('.subscription-quota')).toHaveCount(1)
  await expect(page.locator('.subscription-quota')).toHaveAttribute('data-component', 'balance_card')
  await expect(page.locator('.subscription-quota-values')).toHaveText('余额0单位USD')
  await expect(page.locator('.subscription-quota')).not.toContainText('周期额度')
})

test('新建方案先选择展示组件，再保存字段映射', async ({ page }) => {
  await openProbe(page, 'daily')
  await page.getByRole('button', { name: '编辑账号' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('select').filter({ has: page.locator('option[value="balance_custom"]') }).selectOption('balance_custom')
  await dialog.getByLabel('展示组件').selectOption('quota')
  await dialog.getByPlaceholder('查询路径，例如 /dashboard/billing').fill('/v1/usage')
  await dialog.getByPlaceholder('总量 JSON Pointer（可选）').fill('/total')
  await dialog.getByPlaceholder('剩余 JSON Pointer（可选）').fill('/remaining')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const saved = await page.evaluate(() => (window as any).__quotaCalls.find((call: any) => call.cmd === 'save_api_account').args.quota)
  expect(saved.presentation).toBe('quota')
  expect(saved.path).toBe('/v1/usage')
  expect(saved.limit_pointer).toBe('/total')
})
