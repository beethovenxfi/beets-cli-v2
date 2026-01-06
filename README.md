# Beets CLI v2

A streamlined Discord bot for BeethovenX that runs automated cron jobs. This version removes all unused commands and focuses solely on the essential cron operations.

Built with modern tooling: **viem** for Ethereum interactions and **Node.js 22+**.

## Requirements

- Node.js >= 22.0.0
- yarn or npm

## Enabled Crons

This bot runs the following automated tasks:

1. **claimStsRewards** - Claims stS rewards every 1 hour
2. **autoVoteDelegate** - Automated voting with delegate (runs every 15 minutes)
3. **scheduleDynamicEclpRangeUpdater** - Updates dynamic ECLP ranges (runs every 1 hour)
4. **scheduleTreasuryNotifications** - Monitors treasury transactions (runs every 1 hour)
5. **scheduleDynamicFeeUpdater** - Updates dynamic swap fees (runs every 5 minutes)

## Installation

1. Clone the repository or navigate to this directory:
```bash
cd beets-cli-v2
```

2. Install dependencies:
```bash
yarn install
# or
npm install
```

3. Copy the environment template and configure:
```bash
cp .env.example .env
```

4. Edit `.env` with your actual values:
   - `DISCORD_TOKEN` - Your Discord bot token
   - `RELIC_UPDATER` - Private key for relic updater wallet (without 0x prefix)
   - `FEE_UPDATER` - Private key for fee updater wallet (without 0x prefix)
   - `MD_DELEGATE` - Private key for MD delegate wallet (without 0x prefix)
   - `SAFE_API_KEY` - Your Safe API key for treasury monitoring

## Running the Bot

Start the bot with:

```bash
yarn start
# or
npm start
```

The bot will:
1. Connect to Discord
2. Initialize all enabled cron jobs
3. Run continuously, executing crons on their scheduled intervals

## Project Structure

```
beets-cli-v2/
├── abi/                          # Contract ABIs
│   └── SonicStaking.json
├── src/
│   ├── app.ts                   # Main entry point
│   ├── client/
│   │   └── discord-client.ts    # Discord client setup
│   ├── config/
│   │   ├── config.ts            # Network and contract configurations
│   │   └── viem-client.ts       # Viem client setup (Sonic network)
│   ├── crons/                   # Cron job implementations
│   │   ├── claim_sts_rewards.ts
│   │   ├── vote_with_delegate.ts
│   │   ├── remind_oor_dynamic_eclps.ts
│   │   ├── notifyTreasuryTxns.ts
│   │   ├── update_swap_fees.ts
│   │   ├── latestVotes.json     # State: Last voting data
│   │   └── latestNonceTreasury.json  # State: Treasury nonces
│   └── interactions/
│       └── send-message.ts      # Discord message utilities
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Migration from v1

This version is a clean rewrite that:
- Removes all slash commands (unused)
- Removes disabled cron jobs
- **Migrates from Hardhat + Ethers.js to Viem** for modern, lightweight Ethereum interactions
- Removes unused dependencies
- Requires Node.js 22+

Only the essential cron jobs that were enabled in the original `app.ts` have been migrated.
