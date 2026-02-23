const ZERO = '0x0000000000000000000000000000000000000000'

export const ADDRESSES = {
  vault: (process.env.NEXT_PUBLIC_VAULT_ADDRESS as `0x${string}`) || ZERO,
  adapterA: (process.env.NEXT_PUBLIC_ADAPTER_A_ADDRESS as `0x${string}`) || ZERO,
  adapterB: (process.env.NEXT_PUBLIC_ADAPTER_B_ADDRESS as `0x${string}`) || ZERO,
  usdt: (process.env.NEXT_PUBLIC_USDT_ADDRESS as `0x${string}`) || ZERO,
} as const

const isProd = process.env.NODE_ENV === 'production'

const missing = Object.entries(ADDRESSES).filter(([, v]) => v === ZERO).map(([k]) => k)
if (missing.length > 0) {
  if (isProd) {
    throw new Error(`[Prophit] Missing contract addresses: ${missing.join(', ')}. Set NEXT_PUBLIC_*_ADDRESS env vars.`)
  }
  console.warn(`[Prophit] Missing contract addresses: ${missing.join(', ')}. Set NEXT_PUBLIC_*_ADDRESS env vars.`)
}

export const addressesConfigured = missing.length === 0

export const VAULT_ABI = [
  {
    type: 'function',
    name: 'vaultBalance',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'positionCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPosition',
    inputs: [{ name: 'positionId', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ProphitVault.Position',
        components: [
          { name: 'adapterA', type: 'address', internalType: 'address' },
          { name: 'adapterB', type: 'address', internalType: 'address' },
          { name: 'marketIdA', type: 'bytes32', internalType: 'bytes32' },
          { name: 'marketIdB', type: 'bytes32', internalType: 'bytes32' },
          { name: 'boughtYesOnA', type: 'bool', internalType: 'bool' },
          { name: 'sharesA', type: 'uint256', internalType: 'uint256' },
          { name: 'sharesB', type: 'uint256', internalType: 'uint256' },
          { name: 'costA', type: 'uint256', internalType: 'uint256' },
          { name: 'costB', type: 'uint256', internalType: 'uint256' },
          { name: 'openedAt', type: 'uint256', internalType: 'uint256' },
          { name: 'closed', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'positions',
    inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      { name: 'adapterA', type: 'address', internalType: 'address' },
      { name: 'adapterB', type: 'address', internalType: 'address' },
      { name: 'marketIdA', type: 'bytes32', internalType: 'bytes32' },
      { name: 'marketIdB', type: 'bytes32', internalType: 'bytes32' },
      { name: 'boughtYesOnA', type: 'bool', internalType: 'bool' },
      { name: 'sharesA', type: 'uint256', internalType: 'uint256' },
      { name: 'sharesB', type: 'uint256', internalType: 'uint256' },
      { name: 'costA', type: 'uint256', internalType: 'uint256' },
      { name: 'costB', type: 'uint256', internalType: 'uint256' },
      { name: 'openedAt', type: 'uint256', internalType: 'uint256' },
      { name: 'closed', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const

export const ADAPTER_ABI = [
  {
    type: 'function',
    name: 'getQuote',
    inputs: [{ name: 'marketId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct MarketQuote',
        components: [
          { name: 'marketId', type: 'bytes32', internalType: 'bytes32' },
          { name: 'yesPrice', type: 'uint256', internalType: 'uint256' },
          { name: 'noPrice', type: 'uint256', internalType: 'uint256' },
          { name: 'yesLiquidity', type: 'uint256', internalType: 'uint256' },
          { name: 'noLiquidity', type: 'uint256', internalType: 'uint256' },
          { name: 'resolved', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const
