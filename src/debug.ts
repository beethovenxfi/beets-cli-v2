import { claimAllStSRewards } from './crons/claim_sts_rewards';
import { updateDynamicEclpRanges } from './crons/remind_oor_dynamic_eclps';
import { sendTreasuryNotifications } from './crons/notifyTreasuryTxns';
import { updateDynamicFees } from './crons/update_swap_fees';
import { voteCheck } from './crons/vote_with_delegate';
import { checkStsSlashing } from './crons/monitor_sts_slashing';
import { checkStsClawBacks } from './crons/monitor_sts_clawback';

const TOKEN = process.env.DISCORD_TOKEN!;

async function debugMe(): Promise<void> {

    // await claimAllStSRewards();
    // await updateDynamicEclpRanges();
    // await updateDynamicFees();
    // await voteCheck();
    // await sendTreasuryNotifications();
    // await checkStsSlashing();
    // await checkStsClawBacks();
}

debugMe();
