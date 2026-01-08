import { client } from './client/discord-client';
import { claimStsRewards } from './crons/claim_sts_rewards';
import { autoVoteDelegate } from './crons/vote_with_delegate';
import { scheduleDynamicEclpRangeUpdater } from './crons/remind_oor_dynamic_eclps';
import { scheduleTreasuryNotifications } from './crons/notifyTreasuryTxns';
import { scheduleDynamicFeeUpdater } from './crons/update_swap_fees';

const TOKEN = process.env.DISCORD_TOKEN!;

client.once('ready', (client) => {
    console.log(`Ready! Logged in as ${client.user.tag}`);
});

client.login(TOKEN);

// Initialize all enabled crons
claimStsRewards();
autoVoteDelegate();
scheduleDynamicEclpRangeUpdater();
scheduleTreasuryNotifications();
// scheduleDynamicFeeUpdater();
