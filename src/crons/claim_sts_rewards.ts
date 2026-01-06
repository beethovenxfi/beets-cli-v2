import { parseUnits } from 'viem';
import { ChannelId, sendMessage } from '../interactions/send-message';
import { networkConfig } from '../config/config';
import { publicClient, createWalletClientFromPrivateKey } from '../config/viem-client';
import axios from 'axios';
import { inlineCode } from '@discordjs/builders';
import sonicStakingAbiJson from '../../abi/SonicStaking.json';

const sonicStakingAbi = sonicStakingAbiJson as any;
const sonicStakingContract = '0xe5da20f15420ad15de0fa650600afc998bbe3955';

export async function claimStsRewards() {
    console.log('Schedule claim sftmx rewards');
    await claimAllStSRewards();
    // every 1 hours
    setInterval(claimAllStSRewards, 60 * 60000);
}

export async function claimAllStSRewards() {
    console.log('claiming sts rewards');

    const updaterBalance = await publicClient.getBalance({
        address: networkConfig.walletAddresses.relicUpdater as `0x${string}`,
    });

    if (updaterBalance < parseUnits('2', 18)) {
        await sendMessage(
            ChannelId.SERVER_STATUS,
            `The wallet for the stS rewardclaiming is running low. Please send S to ${inlineCode(
                networkConfig.walletAddresses.relicUpdater,
            )}!`,
        );
        return;
    }

    const backendUrl = 'https://backend-v3.beets-ftm-node.com/graphql';
    const response = (await axios.post(backendUrl, {
        query: ` query {
            stsGetGqlStakedSonicData {
                delegatedValidators {
                validatorId
                }
            }
            }`,
    })) as { data: { data: { stsGetGqlStakedSonicData: { delegatedValidators: { validatorId: string }[] } } } };

    const validatorIds = response.data.data.stsGetGqlStakedSonicData.delegatedValidators.map((v) =>
        BigInt(v.validatorId),
    );

    try {
        if (!process.env.RELIC_UPDATER) {
            console.log('No RELIC_UPDATER private key configured');
            return;
        }

        const walletClient = createWalletClientFromPrivateKey(process.env.RELIC_UPDATER);

        const { request } = await publicClient.simulateContract({
            address: sonicStakingContract as `0x${string}`,
            abi: sonicStakingAbi,
            functionName: 'claimRewards',
            args: [validatorIds],
            account: walletClient.account,
        });

        const hash = await walletClient.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });

        console.log(`Successfully claimed sts rewards. Tx hash: ${hash}`);
    } catch (e) {
        console.log(`Failed to claim sts rewards: ${e}`);
        await sendMessage(ChannelId.SERVER_STATUS, `Error while claiming sts rewards: ${e}`);
    }
}
