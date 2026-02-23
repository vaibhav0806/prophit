import { defineChain } from 'viem'

const isProd = process.env.NODE_ENV === 'production'

const rawChainId = process.env.NEXT_PUBLIC_CHAIN_ID
const rawRpcUrl = process.env.NEXT_PUBLIC_RPC_URL

if (isProd && !rawChainId) {
  throw new Error('[Prophit] NEXT_PUBLIC_CHAIN_ID is required in production')
}
if (isProd && !rawRpcUrl) {
  throw new Error('[Prophit] NEXT_PUBLIC_RPC_URL is required in production')
}

const chainId = Number(rawChainId || '31337')
const rpcUrl = rawRpcUrl || 'http://127.0.0.1:8545'

export const appChain = defineChain({
  id: chainId,
  name: process.env.NEXT_PUBLIC_CHAIN_NAME || 'Anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
})
