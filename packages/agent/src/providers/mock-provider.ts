import type { PublicClient } from "viem";
import { MarketProvider } from "./base.js";
import type { MarketQuote } from "../types.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";

const getQuoteAbi = [
  {
    type: "function",
    name: "getQuote",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct MarketQuote",
        components: [
          { name: "marketId", type: "bytes32", internalType: "bytes32" },
          { name: "yesPrice", type: "uint256", internalType: "uint256" },
          { name: "noPrice", type: "uint256", internalType: "uint256" },
          { name: "yesLiquidity", type: "uint256", internalType: "uint256" },
          { name: "noLiquidity", type: "uint256", internalType: "uint256" },
          { name: "resolved", type: "bool", internalType: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export class MockProvider extends MarketProvider {
  private client: PublicClient;
  private marketIds: `0x${string}`[];

  constructor(
    client: PublicClient,
    adapterAddress: `0x${string}`,
    name: string,
    marketIds: `0x${string}`[],
  ) {
    super(name, adapterAddress);
    this.client = client;
    this.marketIds = marketIds;
  }

  async fetchQuotes(): Promise<MarketQuote[]> {
    const quotes: MarketQuote[] = [];

    for (const marketId of this.marketIds) {
      try {
        const result = await withRetry(
          () => this.client.readContract({
            address: this.adapterAddress,
            abi: getQuoteAbi,
            functionName: "getQuote",
            args: [marketId],
          }),
          { label: `getQuote(${this.name}, ${marketId})` },
        );

        // Skip resolved markets
        if (result.resolved) continue;

        quotes.push({
          marketId: result.marketId,
          protocol: this.name,
          yesPrice: result.yesPrice,
          noPrice: result.noPrice,
          yesLiquidity: result.yesLiquidity,
          noLiquidity: result.noLiquidity,
        });
      } catch (err) {
        log.error("Failed to fetch quote", {
          provider: this.name,
          marketId,
          error: String(err),
        });
      }
    }

    return quotes;
  }
}
