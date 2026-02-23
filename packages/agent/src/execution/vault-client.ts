import { parseEventLogs } from "viem";
import type { PublicClient, WalletClient } from "viem";
import type { Position } from "../types.js";
import { log } from "../logger.js";

const vaultAbi = [
  {
    type: "function",
    name: "openPosition",
    inputs: [
      { name: "adapterA", type: "address" },
      { name: "adapterB", type: "address" },
      { name: "marketIdA", type: "bytes32" },
      { name: "marketIdB", type: "bytes32" },
      { name: "buyYesOnA", type: "bool" },
      { name: "amountA", type: "uint256" },
      { name: "amountB", type: "uint256" },
      { name: "minSharesA", type: "uint256" },
      { name: "minSharesB", type: "uint256" },
    ],
    outputs: [{ name: "positionId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "closePosition",
    inputs: [
      { name: "positionId", type: "uint256" },
      { name: "minPayout", type: "uint256" },
    ],
    outputs: [{ name: "totalPayout", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getPosition",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "adapterA", type: "address" },
          { name: "adapterB", type: "address" },
          { name: "marketIdA", type: "bytes32" },
          { name: "marketIdB", type: "bytes32" },
          { name: "boughtYesOnA", type: "bool" },
          { name: "sharesA", type: "uint256" },
          { name: "sharesB", type: "uint256" },
          { name: "costA", type: "uint256" },
          { name: "costB", type: "uint256" },
          { name: "openedAt", type: "uint256" },
          { name: "closed", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "positionCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vaultBalance",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export interface OpenPositionParams {
  adapterA: `0x${string}`;
  adapterB: `0x${string}`;
  marketIdA: `0x${string}`;
  marketIdB: `0x${string}`;
  buyYesOnA: boolean;
  amountA: bigint;
  amountB: bigint;
  minSharesA: bigint;
  minSharesB: bigint;
}

export class VaultClient {
  private walletClient: WalletClient;
  readonly publicClient: PublicClient;
  private vaultAddress: `0x${string}`;

  constructor(
    walletClient: WalletClient,
    publicClient: PublicClient,
    vaultAddress: `0x${string}`,
  ) {
    this.walletClient = walletClient;
    this.publicClient = publicClient;
    this.vaultAddress = vaultAddress;
  }

  async openPosition(params: OpenPositionParams): Promise<bigint> {
    const { request } = await this.publicClient.simulateContract({
      address: this.vaultAddress,
      abi: vaultAbi,
      functionName: "openPosition",
      args: [
        params.adapterA,
        params.adapterB,
        params.marketIdA,
        params.marketIdB,
        params.buyYesOnA,
        params.amountA,
        params.amountB,
        params.minSharesA,
        params.minSharesB,
      ],
      account: this.walletClient.account!,
    });
    const hash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`Transaction reverted: ${hash}`);
    }
    log.info("openPosition tx confirmed", { hash: receipt.transactionHash });

    // Parse PositionOpened event from receipt logs
    const positionOpenedAbi = [{
      type: 'event' as const,
      name: 'PositionOpened' as const,
      inputs: [
        { name: 'positionId' as const, type: 'uint256' as const, indexed: true as const },
        { name: 'marketIdA' as const, type: 'bytes32' as const, indexed: false as const },
        { name: 'marketIdB' as const, type: 'bytes32' as const, indexed: false as const },
        { name: 'costA' as const, type: 'uint256' as const, indexed: false as const },
        { name: 'costB' as const, type: 'uint256' as const, indexed: false as const },
      ],
    }] as const;

    const logs = parseEventLogs({
      abi: positionOpenedAbi,
      logs: receipt.logs,
      eventName: 'PositionOpened',
    });

    if (logs.length === 0) {
      throw new Error('PositionOpened event not found in receipt');
    }

    return logs[0].args.positionId;
  }

  async closePosition(positionId: number, minPayout: bigint = 0n): Promise<bigint> {
    const { request } = await this.publicClient.simulateContract({
      address: this.vaultAddress,
      abi: vaultAbi,
      functionName: "closePosition",
      args: [BigInt(positionId), minPayout],
      account: this.walletClient.account!,
    });
    const hash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`Transaction reverted: ${hash}`);
    }
    log.info("closePosition tx confirmed", { hash: receipt.transactionHash });

    const positionClosedAbi = [{
      type: 'event' as const,
      name: 'PositionClosed' as const,
      inputs: [
        { name: 'positionId' as const, type: 'uint256' as const, indexed: true as const },
        { name: 'payout' as const, type: 'uint256' as const, indexed: false as const },
      ],
    }] as const;

    const logs = parseEventLogs({
      abi: positionClosedAbi,
      logs: receipt.logs,
      eventName: 'PositionClosed',
    });

    if (logs.length === 0) {
      throw new Error('PositionClosed event not found in receipt');
    }

    return logs[0].args.payout;
  }

  async getPosition(positionId: number): Promise<Position> {
    const result = await this.publicClient.readContract({
      address: this.vaultAddress,
      abi: vaultAbi,
      functionName: "getPosition",
      args: [BigInt(positionId)],
    });

    return {
      positionId,
      adapterA: result.adapterA,
      adapterB: result.adapterB,
      marketIdA: result.marketIdA,
      marketIdB: result.marketIdB,
      boughtYesOnA: result.boughtYesOnA,
      sharesA: result.sharesA,
      sharesB: result.sharesB,
      costA: result.costA,
      costB: result.costB,
      openedAt: result.openedAt,
      closed: result.closed,
    };
  }

  async getPositionCount(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: vaultAbi,
      functionName: "positionCount",
    });
  }

  async getVaultBalance(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: vaultAbi,
      functionName: "vaultBalance",
    });
  }

  async getAllPositions(): Promise<Position[]> {
    const count = await this.getPositionCount();
    if (count === 0n) return [];

    const promises = [];
    for (let i = 0; i < Number(count); i++) {
      promises.push(this.getPosition(i));
    }

    return Promise.all(promises);
  }
}
