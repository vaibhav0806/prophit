import { defineChain } from 'viem'

const isProd = process.env.NODE_ENV === 'production'

const rawChainId = process.env.NEXT_PUBLIC_CHAIN_ID
const rawRpcUrl = process.env.NEXT_PUBLIC_RPC_URL

if (isProd && !rawChainId) {
  console.warn('[Prophet] NEXT_PUBLIC_CHAIN_ID is not set — defaulting to 31337')
}
if (isProd && !rawRpcUrl) {
  console.warn('[Prophet] NEXT_PUBLIC_RPC_URL is not set — defaulting to localhost')
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
