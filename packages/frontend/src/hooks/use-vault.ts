'use client'

import { useReadContract } from 'wagmi'
import { ADDRESSES, VAULT_ABI, addressesConfigured } from '@/lib/contracts'

export function useVaultBalance() {
  return useReadContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'vaultBalance',
    query: { enabled: addressesConfigured },
  })
}

export function usePositionCount() {
  return useReadContract({
    address: ADDRESSES.vault,
    abi: VAULT_ABI,
    functionName: 'positionCount',
    query: { enabled: addressesConfigured },
  })
}
