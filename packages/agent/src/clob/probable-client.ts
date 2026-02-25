import { encodeFunctionData } from "viem"
import type { PublicClient, WalletClient } from "viem"
import type {
  ClobClient,
  PlaceOrderParams,
  OrderResult,
  OrderSide,
  OrderStatusResult,
  OrderStatus,
} from "./types.js"
import { buildOrder, signOrder, signClobAuth, serializeOrder, buildHmacSignature } from "./signing.js"
import { log } from "../logger.js"
import { withRetry } from "../retry.js"

/** Probable Markets EIP-712 domain name (NOT "ClobExchange") */
const PROBABLE_DOMAIN_NAME = "Probable CTF Exchange"

/** Probable amount scaling: 1e18 (NOT Polymarket's 1e6) */
const PROBABLE_SCALE = 1_000_000_000_000_000_000

/** Probable minimum feeRateBps (1.75%) */
const PROBABLE_MIN_FEE_RATE_BPS = 175

/** Probable Markets CTF (ERC-1155 conditional tokens) */
const PROBABLE_CTF_ADDRESS = "0x364d05055614B506e2b9A287E4ac34167204cA83" as `0x${string}`

/** Minimal ABI fragments for approval checks */
const ERC1155_IS_APPROVED_ABI = [{
  type: "function" as const,
  name: "isApprovedForAll" as const,
  inputs: [
    { name: "account", type: "address" as const },
    { name: "operator", type: "address" as const },
  ],
  outputs: [{ name: "", type: "bool" as const }],
  stateMutability: "view" as const,
}] as const

const ERC20_ALLOWANCE_ABI = [{
  type: "function" as const,
  name: "allowance" as const,
  inputs: [
    { name: "owner", type: "address" as const },
    { name: "spender", type: "address" as const },
  ],
  outputs: [{ name: "", type: "uint256" as const }],
  stateMutability: "view" as const,
}] as const

const ERC1155_SET_APPROVAL_ABI = [{
  type: "function" as const,
  name: "setApprovalForAll" as const,
  inputs: [
    { name: "operator", type: "address" as const },
    { name: "approved", type: "bool" as const },
  ],
  outputs: [],
  stateMutability: "nonpayable" as const,
}] as const

const ERC20_APPROVE_ABI = [{
  type: "function" as const,
  name: "approve" as const,
  inputs: [
    { name: "spender", type: "address" as const },
    { name: "amount", type: "uint256" as const },
  ],
  outputs: [{ name: "", type: "bool" as const }],
  stateMutability: "nonpayable" as const,
}] as const

const SAFE_GET_THRESHOLD_ABI = [{
  type: "function" as const,
  name: "getThreshold" as const,
  inputs: [],
  outputs: [{ name: "", type: "uint256" as const }],
  stateMutability: "view" as const,
}] as const

const SAFE_GET_OWNERS_ABI = [{
  type: "function" as const,
  name: "getOwners" as const,
  inputs: [],
  outputs: [{ name: "", type: "address[]" as const }],
  stateMutability: "view" as const,
}] as const

const ERC20_BALANCE_OF_ABI = [{
  type: "function" as const,
  name: "balanceOf" as const,
  inputs: [{ name: "account", type: "address" as const }],
  outputs: [{ name: "", type: "uint256" as const }],
  stateMutability: "view" as const,
}] as const

const ERC20_TRANSFER_ABI = [{
  type: "function" as const,
  name: "transfer" as const,
  inputs: [
    { name: "to", type: "address" as const },
    { name: "amount", type: "uint256" as const },
  ],
  outputs: [{ name: "", type: "bool" as const }],
  stateMutability: "nonpayable" as const,
}] as const

/** BSC USDT */
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`

/** Gnosis Safe v1.3.0 ABI fragments for execTransaction */
const SAFE_NONCE_ABI = [{
  type: "function" as const,
  name: "nonce" as const,
  inputs: [],
  outputs: [{ name: "", type: "uint256" as const }],
  stateMutability: "view" as const,
}] as const

const SAFE_EXEC_TX_ABI = [{
  type: "function" as const,
  name: "execTransaction" as const,
  inputs: [
    { name: "to", type: "address" as const },
    { name: "value", type: "uint256" as const },
    { name: "data", type: "bytes" as const },
    { name: "operation", type: "uint8" as const },
    { name: "safeTxGas", type: "uint256" as const },
    { name: "baseGas", type: "uint256" as const },
    { name: "gasPrice", type: "uint256" as const },
    { name: "gasToken", type: "address" as const },
    { name: "refundReceiver", type: "address" as const },
    { name: "signatures", type: "bytes" as const },
  ],
  outputs: [{ name: "", type: "bool" as const }],
  stateMutability: "payable" as const,
}] as const

/** EIP-712 SafeTx types for Gnosis Safe v1.3.0 */
const SAFE_TX_EIP712_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`

export class ProbableClobClient implements ClobClient {
  readonly name = "Probable"
  readonly exchangeAddress: `0x${string}`

  private walletClient: WalletClient
  private apiBase: string
  private chainId: number
  private feeRateBps: number
  private expirationSec: number
  private dryRun: boolean
  private nonce: bigint
  private proxyAddress: `0x${string}` | null

  private apiKey: string | null
  private apiSecret: string | null
  private apiPassphrase: string | null

  constructor(params: {
    walletClient: WalletClient
    apiBase: string
    exchangeAddress: `0x${string}`
    chainId: number
    expirationSec?: number
    dryRun?: boolean
    proxyAddress?: `0x${string}`
  }) {
    this.walletClient = params.walletClient
    this.apiBase = params.apiBase.replace(/\/+$/, "")
    this.exchangeAddress = params.exchangeAddress
    this.chainId = params.chainId
    this.feeRateBps = 0
    this.expirationSec = params.expirationSec ?? 300
    this.dryRun = params.dryRun ?? false
    this.nonce = 0n
    this.proxyAddress = params.proxyAddress ?? null
    this.apiKey = null
    this.apiSecret = null
    this.apiPassphrase = null
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  private async getL1AuthHeaders(): Promise<Record<string, string>> {
    const auth = await signClobAuth(this.walletClient, this.chainId)
    return {
      Prob_address: auth.address,
      Prob_signature: auth.signature,
      Prob_timestamp: auth.timestamp,
      Prob_nonce: "0",
    }
  }

  private getL2AuthHeaders(method: string, requestPath: string, body?: string): Record<string, string> {
    if (!this.apiKey || !this.apiSecret || !this.apiPassphrase) {
      throw new Error("L2 auth not initialized — call authenticate() first")
    }
    const timestamp = Math.floor(Date.now() / 1000)
    const sig = buildHmacSignature(this.apiSecret, timestamp, method, requestPath, body)
    const account = this.walletClient.account
    if (!account) throw new Error("WalletClient has no account")
    return {
      Prob_address: account.address,
      Prob_signature: sig,
      Prob_timestamp: String(timestamp),
      Prob_api_key: this.apiKey,
      Prob_passphrase: this.apiPassphrase,
    }
  }

  // ---------------------------------------------------------------------------
  // ClobClient interface
  // ---------------------------------------------------------------------------

  async authenticate(): Promise<void> {
    const headers = await this.getL1AuthHeaders()
    const createUrl = `${this.apiBase}/public/api/v1/auth/api-key/${this.chainId}`

    log.info("Probable: creating API key", { chainId: this.chainId })

    let data: Record<string, unknown> | null = null

    try {
      const res = await withRetry(
        () =>
          fetch(createUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable createApiKey" },
      )

      if (res.ok) {
        data = await res.json() as Record<string, unknown>
      } else {
        log.info("Probable: createApiKey returned non-ok, falling back to deriveApiKey", { status: res.status })
      }
    } catch (err) {
      log.info("Probable: createApiKey failed, falling back to deriveApiKey", { error: String(err) })
    }

    if (!data) {
      const deriveHeaders = await this.getL1AuthHeaders()
      const deriveUrl = `${this.apiBase}/public/api/v1/auth/derive-api-key/${this.chainId}`

      const res = await withRetry(
        () =>
          fetch(deriveUrl, {
            method: "GET",
            headers: deriveHeaders,
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable deriveApiKey" },
      )

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`Probable deriveApiKey failed: HTTP ${res.status} ${body}`)
      }

      data = await res.json() as Record<string, unknown>
    }

    this.apiKey = data.apiKey as string
    this.apiSecret = data.secret as string
    this.apiPassphrase = data.passphrase as string

    log.info("Probable: L2 auth initialized", { apiKey: this.apiKey?.slice(0, 8) + "..." })
  }

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const account = this.walletClient.account
    if (!account) return { success: false, error: "WalletClient has no account" }

    if (this.dryRun) {
      log.info("DRY RUN: skipping order build/sign", { tokenId: params.tokenId, side: params.side, price: params.price, size: params.size })
      return { success: true, orderId: "dry-run", status: "DRY_RUN" }
    }

    const { tokenId, side, price, size } = params

    try {
      const maker = this.proxyAddress ?? account.address
      const feeRateBps = Math.max(this.feeRateBps, PROBABLE_MIN_FEE_RATE_BPS)

      const order = buildOrder({
        maker,
        signer: account.address,
        tokenId,
        side,
        price,
        size,
        feeRateBps,
        expirationSec: this.expirationSec,
        nonce: this.nonce,
        scale: PROBABLE_SCALE,
        signatureType: this.proxyAddress ? 2 : 0,
        quantize: true,
        slippageBps: 100, // 1% slippage buffer for FOK fills
      })

      const signed = await signOrder(
        this.walletClient,
        order,
        this.chainId,
        this.exchangeAddress,
        PROBABLE_DOMAIN_NAME,
      )

      const serialized = serializeOrder(signed.order)
      // Probable API requires exact key order for HMAC body verification.
      // Outer: deferExec, order, owner, orderType
      // Inner order: salt, maker, signer, taker, tokenId, makerAmount, takerAmount,
      //   side, expiration, nonce, feeRateBps, signatureType, signature
      const body = {
        deferExec: false,
        order: {
          salt: serialized.salt,
          maker: serialized.maker,
          signer: serialized.signer,
          taker: serialized.taker,
          tokenId: serialized.tokenId,
          makerAmount: serialized.makerAmount,
          takerAmount: serialized.takerAmount,
          side: serialized.side,
          expiration: serialized.expiration,
          nonce: serialized.nonce,
          feeRateBps: serialized.feeRateBps,
          signatureType: serialized.signatureType,
          signature: signed.signature,
        },
        owner: maker,
        orderType: "FOK",
      }

      log.info("Probable order built", {
        tokenId,
        side,
        price,
        size,
        nonce: this.nonce,
        dryRun: this.dryRun,
      })

      if (this.dryRun) {
        log.info("DRY RUN: skipping POST", { body })
        return { success: true, orderId: "dry-run", status: "DRY_RUN" }
      }

      const requestPath = `/public/api/v1/order/${this.chainId}`
      const bodyStr = JSON.stringify(body)
      const headers = this.getL2AuthHeaders("POST", requestPath, bodyStr)

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}${requestPath}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: bodyStr,
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable placeOrder" },
      )

      const data = await res.json() as Record<string, unknown>

      if (!res.ok) {
        log.error("Probable placeOrder failed", { status: res.status, data })
        const errObj = data.error as Record<string, unknown> | string | undefined
        const errMsg = typeof errObj === "string"
          ? errObj
          : typeof errObj === "object" && errObj !== null
            ? String(errObj.message ?? errObj.description ?? `HTTP ${res.status}`)
            : `HTTP ${res.status}`
        return { success: false, error: errMsg }
      }

      log.info("Probable order placed", { data })

      const rawId = data.orderId ?? data.orderID ?? data.id
      return {
        success: true,
        orderId: rawId != null ? String(rawId) : undefined,
        status: typeof data.status === "string" ? data.status : "SUBMITTED",
        transactionHash: typeof data.transactionsHashes === "string"
          ? data.transactionsHashes
          : undefined,
      }
    } catch (err) {
      log.error("Probable placeOrder error", { error: String(err) })
      return { success: false, error: String(err) }
    }
  }

  async cancelOrder(orderId: string, tokenId?: string): Promise<boolean> {
    if (this.dryRun) {
      log.info("DRY RUN: skipping cancel", { orderId })
      return true
    }

    if (!tokenId) {
      log.error("Probable cancelOrder requires tokenId", { orderId })
      return false
    }

    try {
      // Probable: DELETE /order/{chainId}/{orderId}?tokenId={tokenId}
      const requestPath = `/public/api/v1/order/${this.chainId}/${orderId}`
      const queryString = `?tokenId=${tokenId}`
      const headers = this.getL2AuthHeaders("DELETE", requestPath + queryString)

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}${requestPath}${queryString}`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable cancelOrder" },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>
        log.error("Probable cancelOrder failed", { status: res.status, orderId, data })
        return false
      }

      log.info("Probable order cancelled", { orderId })
      return true
    } catch (err) {
      log.error("Probable cancelOrder error", { error: String(err) })
      return false
    }
  }

  async getOpenOrders(): Promise<Array<{ orderId: string; tokenId: string; side: OrderSide; price: number; size: number }>> {
    try {
      const requestPath = `/public/api/v1/orders/${this.chainId}/open`
      const headers = this.getL2AuthHeaders("GET", requestPath)

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}${requestPath}`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable getOpenOrders" },
      )

      if (!res.ok) {
        log.error("Probable getOpenOrders failed", { status: res.status })
        return []
      }

      const json = await res.json()
      const data = Array.isArray(json) ? json : Array.isArray(json?.orders) ? json.orders : []
      return (data as Array<Record<string, unknown>>).map((o) => ({
        orderId: String(o.orderID ?? o.orderId ?? o.id ?? ""),
        tokenId: String(o.tokenId ?? o.asset_id ?? ""),
        side: (String(o.side).toUpperCase() === "SELL" ? "SELL" : "BUY") as OrderSide,
        price: Number(o.price ?? 0),
        size: Number(o.size ?? o.original_size ?? 0),
      }))
    } catch (err) {
      log.error("Probable getOpenOrders error", { error: String(err) })
      return []
    }
  }

  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    try {
      const requestPath = `/public/api/v1/order/${this.chainId}/${orderId}`
      const headers = this.getL2AuthHeaders("GET", requestPath)

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}${requestPath}`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable getOrderStatus" },
      )

      if (!res.ok) {
        // FOK orders fill/cancel instantly and are removed from the order book.
        // A 404 after a successful POST means the order was processed and is gone → treat as FILLED.
        if (res.status === 404) {
          log.info("Probable getOrderStatus 404 — FOK order processed (treating as FILLED)", { orderId })
          return { orderId, status: "FILLED", filledSize: 0, remainingSize: 0 }
        }
        log.warn("Probable getOrderStatus failed", { orderId, status: res.status })
        return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 }
      }

      const data = await res.json() as Record<string, unknown>
      const rawStatus = String(data.status ?? data.order_status ?? "UNKNOWN").toUpperCase()

      const status: OrderStatus = (() => {
        switch (rawStatus) {
          case "MATCHED":
          case "FILLED":
            return "FILLED"
          case "LIVE":
          case "OPEN":
            return "OPEN"
          case "PARTIAL":
          case "PARTIALLY_FILLED":
            return "PARTIAL"
          case "CANCELLED":
          case "CANCELED":
            return "CANCELLED"
          case "EXPIRED":
            return "EXPIRED"
          default:
            return "UNKNOWN"
        }
      })()

      const filledSize = Number(data.filled_size ?? data.filledSize ?? data.size_matched ?? 0)
      const originalSize = Number(data.original_size ?? data.size ?? data.originalSize ?? 0)

      return {
        orderId,
        status,
        filledSize,
        remainingSize: Math.max(0, originalSize - filledSize),
      }
    } catch (err) {
      log.error("Probable getOrderStatus error", { orderId, error: String(err) })
      return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 }
    }
  }

  async ensureApprovals(publicClient: PublicClient, fundingThreshold?: bigint): Promise<void> {
    const account = this.walletClient.account
    if (!account) {
      log.warn("Cannot check approvals: WalletClient has no account")
      return
    }

    // When using a Safe proxy, approvals must come FROM the Safe (not the EOA)
    const approvalOwner = this.proxyAddress ?? account.address
    const useSafe = !!this.proxyAddress

    // Check ERC-1155 CTF approval
    const isApproved = await publicClient.readContract({
      address: PROBABLE_CTF_ADDRESS,
      abi: ERC1155_IS_APPROVED_ABI,
      functionName: "isApprovedForAll",
      args: [approvalOwner, this.exchangeAddress],
    })

    if (!isApproved) {
      const callData = encodeFunctionData({
        abi: ERC1155_SET_APPROVAL_ABI,
        functionName: "setApprovalForAll",
        args: [this.exchangeAddress, true],
      })
      log.info("CTF ERC-1155 not approved — sending setApprovalForAll", {
        ctf: PROBABLE_CTF_ADDRESS,
        exchange: this.exchangeAddress,
        from: approvalOwner,
        viaSafe: useSafe,
      })
      if (useSafe) {
        await this.execSafeTransaction(publicClient, PROBABLE_CTF_ADDRESS, callData)
      } else {
        const txHash = await this.walletClient.writeContract({
          account,
          chain: this.walletClient.chain,
          address: PROBABLE_CTF_ADDRESS,
          abi: ERC1155_SET_APPROVAL_ABI,
          functionName: "setApprovalForAll",
          args: [this.exchangeAddress, true],
        })
        log.info("CTF setApprovalForAll tx sent, waiting for confirmation", { txHash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status === "reverted") {
          log.error("CTF setApprovalForAll reverted", { txHash })
        } else {
          log.info("CTF setApprovalForAll confirmed", { txHash, blockNumber: receipt.blockNumber })
        }
      }
    }

    // Check USDT allowance
    const allowance = await publicClient.readContract({
      address: BSC_USDT,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [approvalOwner, this.exchangeAddress],
    })

    if (allowance === 0n) {
      const callData = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [this.exchangeAddress, 2n ** 256n - 1n],
      })
      log.info("USDT allowance is 0 — sending approve (max)", {
        usdt: BSC_USDT,
        exchange: this.exchangeAddress,
        from: approvalOwner,
        viaSafe: useSafe,
      })
      if (useSafe) {
        await this.execSafeTransaction(publicClient, BSC_USDT, callData)
      } else {
        const txHash = await this.walletClient.writeContract({
          account,
          chain: this.walletClient.chain,
          address: BSC_USDT,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [this.exchangeAddress, 2n ** 256n - 1n],
        })
        log.info("USDT approve tx sent, waiting for confirmation", { txHash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status === "reverted") {
          log.error("USDT approve reverted", { txHash })
        } else {
          log.info("USDT approve confirmed", { txHash, blockNumber: receipt.blockNumber })
        }
      }
    } else {
      log.info("USDT allowance for Probable exchange", { allowance, from: approvalOwner })
    }

    // Safe validation + auto-funding
    if (this.proxyAddress) {
      await this.validateSafe(publicClient)
      if (fundingThreshold !== undefined) {
        await this.autoFundSafe(publicClient, fundingThreshold)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Safe validation + auto-funding
  // ---------------------------------------------------------------------------

  private async validateSafe(publicClient: PublicClient): Promise<void> {
    const account = this.walletClient.account
    if (!account || !this.proxyAddress) return

    const [threshold, owners] = await Promise.all([
      publicClient.readContract({
        address: this.proxyAddress,
        abi: SAFE_GET_THRESHOLD_ABI,
        functionName: "getThreshold",
      }),
      publicClient.readContract({
        address: this.proxyAddress,
        abi: SAFE_GET_OWNERS_ABI,
        functionName: "getOwners",
      }),
    ])

    if (threshold !== 1n) {
      throw new Error(`Safe threshold is ${threshold}, expected 1 (multi-sig not supported)`)
    }

    const eoaLower = account.address.toLowerCase()
    const isOwner = (owners as readonly `0x${string}`[]).some(
      (o) => o.toLowerCase() === eoaLower,
    )
    if (!isOwner) {
      throw new Error(`EOA ${account.address} is not an owner of Safe ${this.proxyAddress}`)
    }

    log.info("Safe validation passed", {
      safe: this.proxyAddress,
      threshold: Number(threshold),
      ownerCount: (owners as readonly `0x${string}`[]).length,
      eoa: account.address,
    })
  }

  private async autoFundSafe(publicClient: PublicClient, fundingThreshold: bigint): Promise<void> {
    const account = this.walletClient.account
    if (!account || !this.proxyAddress) return

    // Read Safe USDT balance
    const safeBalance = await publicClient.readContract({
      address: BSC_USDT,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [this.proxyAddress],
    })

    // fundingThreshold is in 6-decimal format (from config.maxPositionSize); convert to 18-dec
    const threshold18 = fundingThreshold * 10n ** 12n

    if (safeBalance >= threshold18) {
      log.info("Safe USDT balance sufficient", {
        safe: this.proxyAddress,
        balance: safeBalance.toString(),
        threshold: threshold18.toString(),
      })
      return
    }

    const deficit = threshold18 - safeBalance

    // Check EOA has enough USDT — reserve half the TOTAL for EOA's own Predict leg
    const eoaBalance = await publicClient.readContract({
      address: BSC_USDT,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })

    // Reserve enough in EOA for the Predict leg (half the position + 5% buffer for fees/gas)
    const halfThreshold18 = threshold18 / 2n;
    const eoaReserve = halfThreshold18 + (halfThreshold18 * 5n / 100n); // half + 5% buffer
    const transferable = eoaBalance > eoaReserve ? eoaBalance - eoaReserve : 0n
    if (transferable === 0n) {
      log.warn("EOA USDT insufficient to fund Safe (need to reserve for Predict leg)", {
        eoaBalance: eoaBalance.toString(),
        eoaReserve: eoaReserve.toString(),
        safe: this.proxyAddress,
      })
      return
    }

    // Transfer the lesser of deficit and transferable (don't drain EOA below reserve)
    const transferAmount = deficit < transferable ? deficit : transferable
    if (transferAmount < deficit) {
      log.warn("Auto-fund: partial transfer (reserving EOA balance for Predict leg)", {
        deficit: deficit.toString(),
        transferAmount: transferAmount.toString(),
        eoaReserve: eoaReserve.toString(),
      })
    }

    log.info("Auto-funding Safe with USDT", {
      safe: this.proxyAddress,
      transferAmount: transferAmount.toString(),
      deficit: deficit.toString(),
      eoaBalance: eoaBalance.toString(),
    })

    const txHash = await this.walletClient.writeContract({
      account,
      chain: this.walletClient.chain,
      address: BSC_USDT,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [this.proxyAddress, transferAmount],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status === "reverted") {
      log.error("Auto-fund USDT transfer reverted", { txHash })
    } else {
      log.info("Auto-fund USDT transfer confirmed", { txHash, blockNumber: receipt.blockNumber, amount: transferAmount.toString() })
    }
  }

  // ---------------------------------------------------------------------------
  // Safe transaction execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a transaction through the Gnosis Safe proxy wallet.
   * Signs a SafeTx EIP-712 message and calls execTransaction on the Safe.
   * Only works for single-owner Safes (threshold=1).
   */
  private async execSafeTransaction(
    publicClient: PublicClient,
    to: `0x${string}`,
    data: `0x${string}`,
  ): Promise<`0x${string}`> {
    const account = this.walletClient.account
    if (!account) throw new Error("WalletClient has no account")
    if (!this.proxyAddress) throw new Error("No proxy address set")

    const safeAddress = this.proxyAddress

    // Get current Safe nonce
    const safeNonce = await publicClient.readContract({
      address: safeAddress,
      abi: SAFE_NONCE_ABI,
      functionName: "nonce",
    })

    log.info("Signing Safe transaction", { safe: safeAddress, to, nonce: safeNonce })

    // Sign SafeTx EIP-712 typed data (v=27/28, standard ECDSA path in Safe)
    const signature = await this.walletClient.signTypedData({
      account,
      domain: {
        chainId: this.chainId,
        verifyingContract: safeAddress,
      },
      types: SAFE_TX_EIP712_TYPES,
      primaryType: "SafeTx",
      message: {
        to,
        value: 0n,
        data,
        operation: 0, // Call
        safeTxGas: 0n,
        baseGas: 0n,
        gasPrice: 0n,
        gasToken: ZERO_ADDR,
        refundReceiver: ZERO_ADDR,
        nonce: safeNonce,
      },
    })

    // Execute through Safe
    const txHash = await this.walletClient.writeContract({
      account,
      chain: this.walletClient.chain,
      address: safeAddress,
      abi: SAFE_EXEC_TX_ABI,
      functionName: "execTransaction",
      args: [
        to,
        0n,
        data,
        0, // Call
        0n,
        0n,
        0n,
        ZERO_ADDR,
        ZERO_ADDR,
        signature,
      ],
    })

    log.info("Safe execTransaction sent, waiting for confirmation", { txHash, safe: safeAddress, to })

    // Wait for confirmation so the Safe nonce increments before the next call
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status === "reverted") {
      throw new Error(`Safe execTransaction reverted: ${txHash}`)
    }

    log.info("Safe execTransaction confirmed", { txHash, blockNumber: receipt.blockNumber })
    return txHash
  }

  // ---------------------------------------------------------------------------
  // Nonce management
  // ---------------------------------------------------------------------------

  async fetchNonce(): Promise<bigint> {
    log.info("Probable fetchNonce: using local nonce (no server endpoint)", { nonce: this.nonce })
    return this.nonce
  }

  getNonce(): bigint {
    return this.nonce
  }

  setNonce(n: bigint): void {
    this.nonce = n
  }
}
