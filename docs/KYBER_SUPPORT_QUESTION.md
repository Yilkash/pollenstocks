# KyberSwap integration question — draft, not sent

We are integrating direct USDG/TSLA swaps on Robinhood Chain (4663) using
`/robinhood/api/v1/routes` and `/robinhood/api/v1/route/build`.

An unsigned build with a synthetic sender/recipient returned:
- Router: `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`
- Executor: `0x8F10B468b06c6FD214B65F87778827F7D113f996`
- `swap` description flags: 512 (`0x200`)
- Packed `targetData`, rather than the standard ABI-encoded SimpleSwapData.

Could you provide the verified executor source or official decoding specification,
especially how the requested Unix-second `deadline` is encoded and enforced?
Is there a supported API option to request standard simple-mode encoding instead?

We already decode the outer token pair, recipient, exact input and minimum output.
We want to verify expiry before enabling execution. No private keys or real-user
wallet details are needed for this question.
