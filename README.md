# 🧩 Menoid — Browser Extension

> A private crypto wallet for the multi-chain world.
>
> [menoid.xyz](https://menoid.xyz)

One wallet, one address, two modes. **Open Mode** is an ordinary multi-chain
wallet. **Noid Mode** moves the same funds through a zero-knowledge privacy pool
— balances, senders, receivers and amounts stay hidden. Monad, Ethereum
Sepolia, Base Sepolia, Solana, Sui and Aptos.

The protocol, circuits and contracts live in
**[menoid-wallet/menoid](https://github.com/menoid-wallet/menoid)**, and the
full write-up is in **[menoid-wallet/Docs](https://github.com/menoid-wallet/Docs)**.

---

## 🎬 Demo

The whole flow on **Monad testnet** — every transaction below is real.

### Create a wallet

| 1. Open Menoid and choose **Create wallet** | 2. Save your 12-word recovery phrase |
|---|---|
| <img src="demo-pics/creation_1.png" width="420"> | <img src="demo-pics/creation_2.png" width="420"> |
| **3. Give the account a local label** | **4. Set a password — it encrypts your keys on this device** |
| <img src="demo-pics/creation_3.png" width="420"> | <img src="demo-pics/creation_4.png" width="420"> |
| **5. Done — one address for every chain** | |
| <img src="demo-pics/creation_5.png" width="420"> | |

### The wallet

| 1. Home in Open Mode | 2. Tap the Menoid icon for **Accounts** | 3. **Add account** to create another | 4. Tap the gear for **Settings** |
|---|---|---|---|
| <img src="demo-pics/open_mode_1.png" width="190"> | <img src="demo-pics/accounts_1.png" width="190"> | <img src="demo-pics/accounts_2.png" width="190"> | <img src="demo-pics/settings.png" width="190"> |

1. The home screen lists your balances on all six chains.
2. Tap the Menoid icon to open the accounts sheet.
3. Tap **Add account** to create a new account.
4. Settings holds your keys, connected sites, sidebar mode and the lock.

### Open Mode — a normal transfer

| 1. Fund the wallet | 2. Tap **Monad** | 3. **Send** to any address | 4. Delivered |
|---|---|---|---|
| <img src="demo-pics/open_mode_2.png" width="190"> | <img src="demo-pics/open_mode_3.png" width="190"> | <img src="demo-pics/open_mode_4.png" width="190"> | <img src="demo-pics/open_mode_5.png" width="190"> |

1. Fund the wallet — here with 10 MON on Monad.
2. Tap **Monad** to see its price, your balance, and Send / Receive.
3. Tap **Send**, paste a recipient and an amount.
4. The transfer is broadcast — public, like any other wallet.

### Register, then Noid Mode

| 1. Register | 2. Noid Mode unlocked | 3. Your private balance |
|---|---|---|
| <img src="demo-pics/register.png" width="240"> | <img src="demo-pics/noid_mode_1.png" width="240"> | <img src="demo-pics/noid_mode_2.png" width="240"> |

1. Switch to **NOID**, pick the funded chains and register — one transaction binds your address to a private identity.
2. Monad now shows your hidden treasure; the other chains still offer **Register**.
3. Tap **Monad** for its private balance and the four private actions: Mask, Unmask, Send, Receive.

### Mask — public funds become private

| 1. Choose an amount | 2. Proof generated | 3. Hidden | 4. Private balance |
|---|---|---|---|
| <img src="demo-pics/noid_mask_1.png" width="190"> | <img src="demo-pics/noid_mask_2.png" width="190"> | <img src="demo-pics/noid_mask_3.png" width="190"> | <img src="demo-pics/noid_mask_4.png" width="190"> |

1. Tap **Mask** and choose how much to hide, plus the relayer fee.
2. The zero-knowledge proof is generated in your browser — about 20 seconds.
3. The MON is locked in the Noid Pool as a private note.
4. Your private balance now shows 4 MON.

### Send privately

| 1. Paste an address | 2. Sent | 3. The receiver's balance |
|---|---|---|
| <img src="demo-pics/noid_send_1.png" width="240"> | <img src="demo-pics/noid_send_2.png" width="240"> | <img src="demo-pics/noid_send_3.png" width="240"> |

1. Tap **Send** and paste an ordinary wallet address — Menoid finds its private identity on-chain. Private transfers are free.
2. The transfer is confirmed; sender, receiver and amount stay hidden.
3. On the receiving account, the 2 MON arrives in its private balance.

### Unmask — private funds back to public

| 1. Choose an amount | 2. Reclaimed |
|---|---|
| <img src="demo-pics/noid_unmask_1.png" width="240"> | <img src="demo-pics/noid_unmask_2.png" width="240"> |

1. Tap **Unmask** and choose an amount — a flat relayer fee applies.
2. The MON is back in your open address.

---

## 📁 What's in here

```
.
├── wallet-extension/   the browser extension (Plasmo + React + Tailwind)
│   ├── popup.tsx           the wallet itself
│   ├── tabs/               onboarding, dapp connect, tx approval
│   ├── components/modes/   Open Mode / Noid Mode / Register views
│   ├── services/           register, mask, unmask, per-chain tx builders
│   ├── crypto/             key derivation, commitments, wallet encryption
│   ├── lib/                networks, RPC, storage, EIP-1193 provider
│   └── assets/zk/          circuit wasm + proving keys
└── backend/            the relayer (Express + MongoDB)
    ├── controllers/        register, deposit/withdraw, transfer, per chain
    ├── indexer/            pool state per chain
    └── helpers/            merkle, commitments, proof plumbing
```

**The relayer broadcasts; it never custodies.** Transactions are signed on the
device and posted as signed bytes. The relayer pays gas so a user does not have
to spend from the address they are keeping private, and is paid with a note the
same proof creates. It can refuse to broadcast — it cannot steal, forge, or see
amounts.

---

## 🚀 Running it

### Extension

```bash
cd wallet-extension
npm install
npm run dev          # load build/chrome-mv3-dev as an unpacked extension
npm run build        # build/chrome-mv3-prod
```

### Relayer

```bash
cd backend
npm install
npm start            # PORT=4000 by default
```

Both read a `.env` that is not committed. The extension's holds
`PLASMO_PUBLIC_*` pool addresses and RPC endpoints (build-time constants —
change one and rebuild); the backend's holds the Mongo URI, the relayer key and
the same addresses. Keep them in step with
[`menoid/deploy.txt`](https://github.com/menoid-wallet/menoid/blob/main/deploy.txt)
— a stale address silently points the wallet at an abandoned pool.

---

## 🔗 Related

| Repository | What it is |
|---|---|
| ⛓️ **[menoid-wallet/menoid](https://github.com/menoid-wallet/menoid)** | Circuits and on-chain contracts |
| 📖 **[menoid-wallet/Docs](https://github.com/menoid-wallet/Docs)** | Protocol documentation |
| 📱 **[menoid-wallet/wallet-android](https://github.com/menoid-wallet/wallet-android)** | The Android app |
| 🌐 **[menoid-wallet/website](https://github.com/menoid-wallet/website)** | [menoid.xyz](https://menoid.xyz) |

---

## ⚠️ Status

Testnet. Unaudited. Do not put real funds anywhere near this.

---

**Menoid — A Private Crypto Wallet.**
