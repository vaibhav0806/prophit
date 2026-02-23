import { describe, it, expect, vi, afterEach } from 'vitest'

describe('addressesConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is false when addresses are zero addresses (defaults)', async () => {
    // No env vars set — all addresses fall back to the zero address
    vi.stubEnv('NEXT_PUBLIC_VAULT_ADDRESS', '')
    vi.stubEnv('NEXT_PUBLIC_ADAPTER_A_ADDRESS', '')
    vi.stubEnv('NEXT_PUBLIC_ADAPTER_B_ADDRESS', '')
    vi.stubEnv('NEXT_PUBLIC_USDT_ADDRESS', '')

    const { addressesConfigured } = await import('@/lib/contracts')
    expect(addressesConfigured).toBe(false)
  })

  it('is false when some addresses are zero addresses', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAULT_ADDRESS', '0x1234567890abcdef1234567890abcdef12345678')
    vi.stubEnv('NEXT_PUBLIC_ADAPTER_A_ADDRESS', '')
    vi.stubEnv('NEXT_PUBLIC_ADAPTER_B_ADDRESS', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    vi.stubEnv('NEXT_PUBLIC_USDT_ADDRESS', '')

    const { addressesConfigured } = await import('@/lib/contracts')
    expect(addressesConfigured).toBe(false)
  })

  it('is true when all addresses are set to real values', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAULT_ADDRESS', '0x1111111111111111111111111111111111111111')
    vi.stubEnv('NEXT_PUBLIC_ADAPTER_A_ADDRESS', '0x2222222222222222222222222222222222222222')
    vi.stubEnv('NEXT_PUBLIC_ADAPTER_B_ADDRESS', '0x3333333333333333333333333333333333333333')
    vi.stubEnv('NEXT_PUBLIC_USDT_ADDRESS', '0x4444444444444444444444444444444444444444')

    const { addressesConfigured } = await import('@/lib/contracts')
    expect(addressesConfigured).toBe(true)
  })
})
