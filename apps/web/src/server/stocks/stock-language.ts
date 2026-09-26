import type { MainnetStock } from "../networks/robinhood";

// Explicit supported aliases only; never fuzzy-match an unknown company for a trade.
const aliases: Record<MainnetStock, RegExp> = {
  AAPL: /(?<![\p{L}\p{N}])(?:AAPL|apple(?:['’]s|s)?)(?![\p{L}\p{N}])/iu,
  NVDA: /(?<![\p{L}\p{N}])(?:NVDA|nvidia(?:['’]s|s)?)(?![\p{L}\p{N}])/iu,
  TSLA: /(?<![\p{L}\p{N}])(?:TSLA|tesla(?:['’]s|s)?)(?![\p{L}\p{N}])/iu,
};
export function mainnetStockMentions(input: string): MainnetStock[] {
  const normalized = input.normalize("NFKC");
  return (Object.keys(aliases) as MainnetStock[]).filter((symbol) =>
    aliases[symbol].test(normalized),
  );
}
