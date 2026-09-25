# Menoid — extension

The browser extension half of Menoid. Built with
[Plasmo](https://docs.plasmo.com/) (React + Tailwind, Manifest V3).

**The overview, the demo and the setup instructions are in the
[repository README](../README.md).**

```bash
npm install
npm run dev      # then load build/chrome-mv3-dev as an unpacked extension
npm run build    # build/chrome-mv3-prod
```

`npm run dev` and `npm run build` both run `build:inpage` first, which bundles
`lib/inpage.ts` into `assets/inpage.js` — that is the EIP-1193 provider a page
sees as `window.ethereum`, and it has to be a standalone IIFE rather than part
of the extension bundle.

Addresses and endpoints come from `PLASMO_PUBLIC_*` variables in `.env`, which
Plasmo inlines **at build time**. Changing one means rebuilding, not reloading.

## Layout

```
popup.tsx            the wallet
sidepanel.tsx        the same wallet, docked
tabs/                onboarding, dapp connect, transaction approval
components/modes/    Open Mode · Noid Mode · Register
components/shared/   mask / unmask / send modals
services/            register, mask, unmask, per-chain tx builders, prices
crypto/              key derivation, commitments, AES-GCM wallet encryption
lib/                 networks, RPC with fallback, storage, provider injection
assets/zk/           circuit wasm + proving keys
```
