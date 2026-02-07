# PRISM Protocol

**Intelligent Risk Markets for DeFi Protection**

PRISM creates continuous prediction markets that price DeFi protocol risk in real time. When risk rises, Chainlink CRE workflows automatically trigger graduated protective actions — no human intervention required.

Built for the **Chainlink Convergence Hackathon 2026**.

## Architecture

```
contracts/          Solidity smart contracts (Foundry)
cre-workflows/      Chainlink CRE workflows (TypeScript)
frontend/           Web UI (Next.js + thirdweb) — Week 3
docs/               Documentation and specs
```

## Quick Start

### Contracts

```bash
cd contracts
forge build
forge test
```

### CRE Workflows

```bash
cd cre-workflows
npm install
npm run build
```

## Environment

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

## License

MIT
