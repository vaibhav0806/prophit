import { defineChain } from 'viem'

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || '31337')

export const appChain = defineChain({
  id: chainId,
  name: process.env.NEXT_PUBLIC_CHAIN_NAME || 'Anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545'] },
  },
})
